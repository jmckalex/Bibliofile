// Bibliophile AppleScript bridge (native, macOS).
//
// The "transport" half of the scripting feature — generic Cocoa-Scripting glue;
// ALL domain logic lives in TS (`ScriptingService`, app/src/main/scripting.ts).
//
//   1. setHandler(fn)  — a single diagnostic verb `bibliophile query` (Phase 1
//      proof; kept for scripts/spike-bibliophile-bridge.sh).
//   2. setDispatch(fn) — the real object model. Proxy objects (application ->
//      document -> publication -> field/author/editor, plus groups) whose KVC
//      getters/setters + element accessors call SYNCHRONOUSLY into the JS
//      scripting service over `dispatch`. Verbs are `<responds-to>` HANDLER
//      METHODS on the receiver class; each does ONE `command` dispatch into TS
//      and surfaces TS errors back to AppleScript. Object-returning verbs return
//      cite keys (text), so the reply Apple Event never needs an object specifier.
//      WIRED + verified: search / export / generate cite key. The make / delete /
//      duplicate / save handlers below are implemented but NOT wired in the sdef:
//      the standard command codes don't route to a synchronous-proxy model (they
//      hang). The fix is Cocoa KVC mutable-element accessors on BPDocument — a
//      follow-up; until then those verbs error cleanly (not declared).
//
// Valid because Electron main-process JS and Apple Events share the main thread.
// Cocoa `key`/`class` names match app/scripting/Bibliophile.sdef.

#include <node_api.h>
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>

// --- JS callbacks (set from the Electron main process) -----------------------

static napi_env g_env = NULL;
static napi_ref g_handler = NULL;   // setHandler: (command, arg) -> text
static napi_ref g_dispatch = NULL;  // setDispatch: (jsonRequest) -> jsonResponse

// Call a stored 1-arg JS string->string function synchronously on the main thread.
static NSString *BPCallString(napi_ref ref, NSArray<NSString *> *args) {
  if (g_env == NULL || ref == NULL) return nil;
  napi_handle_scope scope;
  if (napi_open_handle_scope(g_env, &scope) != napi_ok) return nil;

  NSString *result = nil;
  napi_value fn = NULL, recv = NULL, ret = NULL;
  if (napi_get_reference_value(g_env, ref, &fn) == napi_ok && fn != NULL) {
    napi_get_undefined(g_env, &recv);
    napi_value argv[4];
    uint32_t argc = 0;
    for (NSString *a in args) {
      if (argc >= 4) break;
      napi_create_string_utf8(g_env, a.UTF8String ?: "", NAPI_AUTO_LENGTH, &argv[argc++]);
    }
    napi_status st = napi_call_function(g_env, recv, fn, argc, argv, &ret);
    if (st == napi_ok && ret != NULL) {
      size_t len = 0;
      if (napi_get_value_string_utf8(g_env, ret, NULL, 0, &len) == napi_ok) {
        char *buf = (char *)malloc(len + 1);
        if (buf != NULL) {
          if (napi_get_value_string_utf8(g_env, ret, buf, len + 1, &len) == napi_ok)
            result = [NSString stringWithUTF8String:buf];
          free(buf);
        }
      }
    } else {
      bool pending = false;
      napi_is_exception_pending(g_env, &pending);
      if (pending) { napi_value e = NULL; napi_get_and_clear_last_exception(g_env, &e); }
    }
  }
  napi_close_handle_scope(g_env, scope);
  return result;
}

// --- proxy object protocol + forward declarations ---------------------------
// Every proxy carries its ElementRef (an NSDictionary, e.g. {kind:"publication",…}).

@protocol BPRef <NSObject>
@property(strong) NSDictionary *ref;
@end

@interface BPPublication : NSObject <BPRef>
@property(strong) NSDictionary *ref;
@end
@interface BPDocument : NSObject <BPRef>
@property(strong) NSDictionary *ref;
@end
@interface BPField : NSObject <BPRef>
@property(strong) NSDictionary *ref;
@end
@interface BPAuthor : NSObject <BPRef>
@property(strong) NSDictionary *ref;
@end
@interface BPGroup : NSObject <BPRef>
@property(strong) NSDictionary *ref;
@end

// --- dispatch helpers (the object model talks to TS through these) ----------

// Full round-trip to ScriptingService.dispatch; returns the parsed {ok,value,error}
// response, or nil on a transport failure.
static NSDictionary *BPResponse(NSString *op, NSDictionary *ref, NSDictionary *extra) {
  if (g_dispatch == NULL) return nil;
  NSMutableDictionary *req = [NSMutableDictionary dictionary];
  req[@"op"] = op;
  req[@"ref"] = ref ?: @{};
  if (extra) [req addEntriesFromDictionary:extra];

  NSError *err = nil;
  NSData *reqData = [NSJSONSerialization dataWithJSONObject:req options:0 error:&err];
  if (reqData == nil) return nil;
  NSString *reqJson = [[NSString alloc] initWithData:reqData encoding:NSUTF8StringEncoding];

  NSString *respJson = BPCallString(g_dispatch, @[ reqJson ]);
  if (respJson == nil) return nil;
  NSDictionary *resp = [NSJSONSerialization JSONObjectWithData:[respJson dataUsingEncoding:NSUTF8StringEncoding]
                                                       options:0 error:&err];
  return [resp isKindOfClass:[NSDictionary class]] ? resp : nil;
}

// The decoded `value` for a successful request, or nil (used by getters/elements,
// which have no NSScriptCommand to carry an error).
static id BPCall(NSString *op, NSDictionary *ref, NSDictionary *extra) {
  NSDictionary *resp = BPResponse(op, ref, extra);
  if (resp == nil || ![resp[@"ok"] boolValue]) return nil;
  return resp[@"value"];
}

static id BPGetProperty(NSDictionary *ref, NSString *name) {
  id v = BPCall(@"getProperty", ref, @{ @"name": name });
  return (v == nil || v == [NSNull null]) ? nil : v;
}

static void BPSetProperty(NSDictionary *ref, NSString *name, id value) {
  BPCall(@"setProperty", ref, @{ @"name": name, @"value": value ?: [NSNull null] });
}

static NSArray *BPElements(NSDictionary *ref, NSString *element) {
  id v = BPCall(@"elements", ref, @{ @"element": element });
  return [v isKindOfClass:[NSArray class]] ? v : @[];
}

// Wrap a TS-returned value into proxy objects (for element accessors). Ref dicts
// become proxies; arrays recurse; scalars pass through.
static id BPWrapValue(id v) {
  if ([v isKindOfClass:[NSArray class]]) {
    NSMutableArray *out = [NSMutableArray array];
    for (id e in (NSArray *)v) { id w = BPWrapValue(e); if (w) [out addObject:w]; }
    return out;
  }
  if ([v isKindOfClass:[NSDictionary class]]) {
    NSString *kind = ((NSDictionary *)v)[@"kind"];
    id<BPRef> obj = nil;
    if ([kind isEqualToString:@"publication"]) obj = [BPPublication new];
    else if ([kind isEqualToString:@"document"]) obj = [BPDocument new];
    else if ([kind isEqualToString:@"group"]) obj = [BPGroup new];
    else if ([kind isEqualToString:@"field"]) obj = [BPField new];
    else if ([kind isEqualToString:@"author"]) obj = [BPAuthor new];
    if (obj) { obj.ref = (NSDictionary *)v; return obj; }
    return nil;
  }
  return (v == [NSNull null]) ? nil : v;  // string / number / boolean
}

static NSArray *BPWrapRefs(NSArray *refs) {
  return BPWrapValue(refs);
}

// The ElementRef behind a proxy object (or nil).
static NSDictionary *BPRefOf(id obj) {
  if ([obj conformsToProtocol:@protocol(BPRef)]) return [(id<BPRef>)obj ref];
  return nil;
}

// Evaluate an object specifier to its object(s); pass other values through.
static id BPEvaluate(id param) {
  if ([param isKindOfClass:[NSScriptObjectSpecifier class]])
    return [(NSScriptObjectSpecifier *)param objectsByEvaluatingSpecifier];
  return param;
}

// A list of ElementRefs from a command argument (a proxy, a list, or a specifier).
static NSArray *BPRefsOf(id param) {
  id v = BPEvaluate(param);
  NSMutableArray *out = [NSMutableArray array];
  if ([v isKindOfClass:[NSArray class]]) {
    for (id e in (NSArray *)v) { NSDictionary *r = BPRefOf(e); if (r) [out addObject:r]; }
  } else {
    NSDictionary *r = BPRefOf(v);
    if (r) [out addObject:r];
  }
  return out;
}

// A POSIX path from a `file`/`text` command argument.
static NSString *BPPathOf(id v) {
  if ([v isKindOfClass:[NSURL class]]) return [(NSURL *)v path];
  if ([v isKindOfClass:[NSString class]]) return (NSString *)v;
  return nil;
}

// Map a publication KVC key (as it arrives in `make`'s KeyDictionary) to the sdef
// human property name the TS service expects.
static NSString *BPHumanPropName(NSString *kvc) {
  static NSDictionary *map = nil;
  if (map == nil) {
    map = @{
      @"citeKey": @"cite key", @"scriptingTitle": @"title", @"scriptingType": @"type",
      @"pubYear": @"publication year", @"pubMonth": @"publication month",
      @"pubAbstract": @"abstract", @"pubKeywords": @"keywords", @"pubNote": @"note",
      @"pubRating": @"rating",
    };
  }
  return map[kvc] ?: kvc;
}

// Common command tail: surface a TS error onto the NSScriptCommand, else return
// the wrapped result (text / list of text / nothing — never a live object).
static id BPCommandResult(NSScriptCommand *cmd, NSDictionary *resp) {
  if (resp == nil) {
    [cmd setScriptErrorNumber:-1700];
    [cmd setScriptErrorString:@"Bibliophile is not responding."];
    return nil;
  }
  if (![resp[@"ok"] boolValue]) {
    [cmd setScriptErrorNumber:-10000];
    id e = resp[@"error"];
    [cmd setScriptErrorString:[e isKindOfClass:[NSString class]] ? e : @"Bibliophile scripting error."];
    return nil;
  }
  return BPWrapValue(resp[@"value"]);
}

// `make new publication` shared by the application + document receivers. `container`
// is the document ref when make is routed to a document, else nil (the application
// case reads the `at` location, else TS falls back to the frontmost document). The
// `with properties` record arrives keyed by KVC key → translate to sdef human names.
static id BPMake(NSScriptCommand *command, NSDictionary *container) {
  NSDictionary *args = [command evaluatedArguments];
  NSDictionary *containerRef = container;
  if (containerRef == nil) {
    id loc = args[@"Location"];
    if ([loc isKindOfClass:[NSPositionalSpecifier class]])
      containerRef = BPRefOf([(NSPositionalSpecifier *)loc insertionContainer]);
  }
  NSMutableDictionary *props = [NSMutableDictionary dictionary];
  id kd = args[@"KeyDictionary"];
  if ([kd isKindOfClass:[NSDictionary class]])
    for (NSString *k in (NSDictionary *)kd) props[BPHumanPropName(k)] = ((NSDictionary *)kd)[k];
  return BPCommandResult(command, BPResponse(@"command", containerRef, @{ @"name": @"make", @"params": @{ @"withProperties": props } }));
}

// --- proxy implementations ---------------------------------------------------

@implementation BPPublication
@synthesize ref;
- (NSString *)uniqueID { return BPGetProperty(self.ref, @"id"); }
- (NSString *)citeKey { return BPGetProperty(self.ref, @"cite key"); }
- (void)setCiteKey:(NSString *)v { BPSetProperty(self.ref, @"cite key", v); }
- (NSString *)scriptingTitle { return BPGetProperty(self.ref, @"title"); }
- (void)setScriptingTitle:(NSString *)v { BPSetProperty(self.ref, @"title", v); }
- (NSString *)scriptingType { return BPGetProperty(self.ref, @"type"); }
- (void)setScriptingType:(NSString *)v { BPSetProperty(self.ref, @"type", v); }
- (NSString *)pubYear { return BPGetProperty(self.ref, @"publication year"); }
- (void)setPubYear:(NSString *)v { BPSetProperty(self.ref, @"publication year", v); }
- (NSString *)pubMonth { return BPGetProperty(self.ref, @"publication month"); }
- (void)setPubMonth:(NSString *)v { BPSetProperty(self.ref, @"publication month", v); }
- (NSString *)pubAbstract { return BPGetProperty(self.ref, @"abstract"); }
- (void)setPubAbstract:(NSString *)v { BPSetProperty(self.ref, @"abstract", v); }
- (NSString *)pubKeywords { return BPGetProperty(self.ref, @"keywords"); }
- (void)setPubKeywords:(NSString *)v { BPSetProperty(self.ref, @"keywords", v); }
- (NSString *)pubNote { return BPGetProperty(self.ref, @"note"); }
- (void)setPubNote:(NSString *)v { BPSetProperty(self.ref, @"note", v); }
- (NSNumber *)pubRating { id v = BPGetProperty(self.ref, @"rating"); return [v isKindOfClass:[NSNumber class]] ? v : @0; }
- (void)setPubRating:(NSNumber *)v { BPSetProperty(self.ref, @"rating", v); }
- (NSString *)localFile { return BPGetProperty(self.ref, @"local file"); }
- (NSString *)remoteURL { return BPGetProperty(self.ref, @"url"); }
- (NSString *)addedDate { return BPGetProperty(self.ref, @"added date"); }
- (NSString *)modifiedDate { return BPGetProperty(self.ref, @"modified date"); }
- (NSArray *)fields { return BPWrapRefs(BPElements(self.ref, @"field")); }
- (NSArray *)authors { return BPWrapRefs(BPElements(self.ref, @"author")); }
- (NSArray *)editors { return BPWrapRefs(BPElements(self.ref, @"editor")); }
// Verbs whose receiver is the publication.
- (id)handleDeleteCommand:(NSScriptCommand *)command {
  return BPCommandResult(command, BPResponse(@"command", self.ref, @{ @"name": @"delete", @"params": @{} }));
}
- (id)handleDuplicateCommand:(NSScriptCommand *)command {
  return BPCommandResult(command, BPResponse(@"command", self.ref, @{ @"name": @"duplicate", @"params": @{} }));
}
- (id)handleGenerateCiteKeyCommand:(NSScriptCommand *)command {
  return BPCommandResult(command, BPResponse(@"command", self.ref, @{ @"name": @"generate cite key", @"params": @{} }));
}
@end

@implementation BPDocument
@synthesize ref;
- (NSString *)scriptingName { return BPGetProperty(self.ref, @"name"); }
- (NSString *)scriptingPath { id v = BPGetProperty(self.ref, @"path"); return v ?: @""; }
- (NSNumber *)scriptingModified { id v = BPGetProperty(self.ref, @"modified"); return [v isKindOfClass:[NSNumber class]] ? v : @NO; }
- (NSArray *)publications { return BPWrapRefs(BPElements(self.ref, @"publication")); }
- (NSArray *)groups { return BPWrapRefs(BPElements(self.ref, @"group")); }
- (NSArray *)libraryGroups { return BPWrapRefs(BPElements(self.ref, @"library group")); }
- (NSArray *)staticGroups { return BPWrapRefs(BPElements(self.ref, @"static group")); }
- (NSArray *)smartGroups { return BPWrapRefs(BPElements(self.ref, @"smart group")); }
- (NSArray *)fieldGroups { return BPWrapRefs(BPElements(self.ref, @"field group")); }
- (NSArray *)externalFileGroups { return BPWrapRefs(BPElements(self.ref, @"external file group")); }
- (NSArray *)scriptGroups { return BPWrapRefs(BPElements(self.ref, @"script group")); }
- (NSArray *)folderGroups { return BPWrapRefs(BPElements(self.ref, @"folder group")); }
// Verbs whose receiver is the document (search / export / save), plus `make` when
// AppleScript routes it to the container (`make new publication at … of document`).
- (id)handleSearchCommand:(NSScriptCommand *)command {
  NSString *forText = [command evaluatedArguments][@"For"];
  return BPCommandResult(command, BPResponse(@"command", self.ref, @{ @"name": @"search", @"params": @{ @"for": forText ?: @"" } }));
}
- (id)handleExportCommand:(NSScriptCommand *)command {
  NSDictionary *args = [command evaluatedArguments];
  NSMutableDictionary *params = [NSMutableDictionary dictionary];
  if (args[@"As"]) params[@"as"] = args[@"As"];
  if (args[@"For"]) params[@"for"] = BPRefsOf(args[@"For"]);
  NSString *to = BPPathOf(args[@"To"]);
  if (to) params[@"to"] = to;
  return BPCommandResult(command, BPResponse(@"command", self.ref, @{ @"name": @"export", @"params": params }));
}
- (id)handleSaveCommand:(NSScriptCommand *)command {
  NSMutableDictionary *params = [NSMutableDictionary dictionary];
  NSString *file = BPPathOf([command evaluatedArguments][@"File"]);
  if (file) params[@"in"] = file;
  return BPCommandResult(command, BPResponse(@"command", self.ref, @{ @"name": @"save", @"params": params }));
}
- (id)handleMakeCommand:(NSScriptCommand *)command {
  return BPMake(command, self.ref);
}
@end

@implementation BPField
@synthesize ref;
- (NSString *)fieldName { return BPGetProperty(self.ref, @"name"); }
- (NSString *)fieldValue { return BPGetProperty(self.ref, @"value"); }
- (void)setFieldValue:(NSString *)v { BPSetProperty(self.ref, @"value", v); }
- (NSNumber *)fieldInherited { id v = BPGetProperty(self.ref, @"inherited"); return [v isKindOfClass:[NSNumber class]] ? v : @NO; }
@end

@implementation BPAuthor
@synthesize ref;
- (NSString *)authorName { return BPGetProperty(self.ref, @"name"); }
- (NSString *)fullName { return BPGetProperty(self.ref, @"full name"); }
- (NSString *)firstName { return BPGetProperty(self.ref, @"first name"); }
- (NSString *)lastName { return BPGetProperty(self.ref, @"last name"); }
- (NSString *)vonPart { return BPGetProperty(self.ref, @"von name part"); }
- (NSString *)jrPart { return BPGetProperty(self.ref, @"jr part"); }
@end

@implementation BPGroup
@synthesize ref;
- (NSString *)groupName { return BPGetProperty(self.ref, @"name"); }
- (NSString *)groupID { return BPGetProperty(self.ref, @"id"); }
- (NSArray *)publications { return BPWrapRefs(BPElements(self.ref, @"publication")); }
@end

// --- application element accessor + diagnostic verb -------------------------

@interface NSApplication (BibliophileModel)
@end
@implementation NSApplication (BibliophileModel)
- (NSArray *)bibliophileDocuments {
  return BPWrapRefs(BPElements(@{ @"kind": @"application" }, @"document"));
}

// `make new publication …` when routed to the application (no container document);
// BPMake reads the `at` location, else TS uses the frontmost document.
- (id)handleMakeCommand:(NSScriptCommand *)command {
  return BPMake(command, nil);
}

// Phase 1 diagnostic verb, routed through setHandler.
- (id)handleBibliophileQueryCommand:(NSScriptCommand *)command {
  NSString *arg = nil;
  id direct = [command directParameter];
  if ([direct isKindOfClass:[NSString class]]) arg = (NSString *)direct;
  NSString *res = BPCallString(g_handler, @[ @"query", arg ?: @"" ]);
  return res ?: @"";
}
@end

// --- N-API surface -----------------------------------------------------------

static napi_value SetRef(napi_env env, napi_callback_info info, napi_ref *slot) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  g_env = env;
  if (*slot != NULL) { napi_delete_reference(env, *slot); *slot = NULL; }
  if (argc >= 1) napi_create_reference(env, argv[0], 1, slot);
  napi_value undef; napi_get_undefined(env, &undef); return undef;
}

static napi_value SetHandler(napi_env env, napi_callback_info info) {
  return SetRef(env, info, &g_handler);
}
static napi_value SetDispatch(napi_env env, napi_callback_info info) {
  return SetRef(env, info, &g_dispatch);
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "setHandler", NAPI_AUTO_LENGTH, SetHandler, NULL, &fn);
  napi_set_named_property(env, exports, "setHandler", fn);
  napi_create_function(env, "setDispatch", NAPI_AUTO_LENGTH, SetDispatch, NULL, &fn);
  napi_set_named_property(env, exports, "setDispatch", fn);
  return exports;
}
