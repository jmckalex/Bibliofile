// Bibliophile AppleScript bridge (native, macOS).
//
// The "transport" half of the scripting feature. Two layers:
//
//   1. setHandler(fn)  — a single diagnostic verb `bibliophile query` (Phase 1
//      proof; kept for scripts/spike-bibliophile-bridge.sh).
//   2. setDispatch(fn) — the real object model. Generic Cocoa-Scripting proxy
//      objects (application -> document -> publication) whose element accessors
//      and property getters call SYNCHRONOUSLY into the JS scripting service
//      (`ScriptingService.dispatch`, see app/src/main/scripting.ts). Valid
//      because Electron main-process JS and Apple Events share the main thread.
//
// All domain logic stays in TS; this file is generic glue.

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

// --- dispatch helpers (the object model talks to TS through these) ----------

// One request to ScriptingService.dispatch; returns the decoded `value`, or nil.
static id BPCall(NSString *op, NSDictionary *ref, NSDictionary *extra) {
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
  if (![resp isKindOfClass:[NSDictionary class]]) return nil;
  if (![resp[@"ok"] boolValue]) return nil;  // TODO: surface error to NSScriptCommand
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

// --- proxy objects -----------------------------------------------------------
// Each holds its ElementRef (an NSDictionary). KVC method names match the sdef
// cocoa keys, so Cocoa Scripting drives them directly.

@interface BPPublication : NSObject
@property(strong) NSDictionary *ref;
@end
@implementation BPPublication
- (NSString *)uniqueID { return BPGetProperty(self.ref, @"id"); }
- (NSString *)citeKey { return BPGetProperty(self.ref, @"cite key"); }
- (void)setCiteKey:(NSString *)v { BPSetProperty(self.ref, @"cite key", v); }
- (NSString *)scriptingTitle { return BPGetProperty(self.ref, @"title"); }
- (void)setScriptingTitle:(NSString *)v { BPSetProperty(self.ref, @"title", v); }
- (NSString *)scriptingType { return BPGetProperty(self.ref, @"type"); }
- (NSString *)pubYear { return BPGetProperty(self.ref, @"publication year"); }
- (NSString *)pubKeywords { return BPGetProperty(self.ref, @"keywords"); }
@end

@interface BPDocument : NSObject
@property(strong) NSDictionary *ref;
@end
@implementation BPDocument
- (NSString *)scriptingName { return BPGetProperty(self.ref, @"name"); }
- (NSArray *)publications {
  NSArray *refs = BPElements(self.ref, @"publication");
  NSMutableArray *out = [NSMutableArray arrayWithCapacity:refs.count];
  for (NSDictionary *r in refs) {
    BPPublication *p = [BPPublication new];
    p.ref = r;
    [out addObject:p];
  }
  return out;
}
@end

@interface NSApplication (BibliophileModel)
@end
@implementation NSApplication (BibliophileModel)
- (NSArray *)bibliophileDocuments {
  NSArray *refs = BPElements(@{ @"kind": @"application" }, @"document");
  NSMutableArray *out = [NSMutableArray arrayWithCapacity:refs.count];
  for (NSDictionary *r in refs) {
    BPDocument *d = [BPDocument new];
    d.ref = r;
    [out addObject:d];
  }
  return out;
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
