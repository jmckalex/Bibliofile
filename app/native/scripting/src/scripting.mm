// Bibliophile AppleScript bridge (native, macOS).
//
// The "transport" half of the scripting feature: a tiny N-API addon that
// installs Cocoa-Scripting command handlers as a category on NSApplication.
// When an Apple Event fires, the handler calls SYNCHRONOUSLY into a JS function
// registered from the Electron main process (`setHandler`). This is valid
// because Electron's main-process JS and Apple Events both run on the main
// thread, so we can re-enter V8 directly during run-loop event processing.
//
// All domain logic lives in TS (the "scripting service" over DocumentStore);
// this file is generic glue. Phase 1 proves ONE command (`bibliophile query`)
// round-trips native -> JS -> native -> AppleScript; later phases add the full
// class/element/verb model.

#include <node_api.h>
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>

static napi_env g_env = NULL;
static napi_ref g_handler = NULL;

// Invoke the registered JS handler synchronously: handler(command, arg) -> text.
// Returns nil on any failure (no handler, JS threw, bad return).
static NSString *BPCallJS(NSString *command, NSString *arg) {
  if (g_env == NULL || g_handler == NULL) return nil;

  napi_handle_scope scope;
  if (napi_open_handle_scope(g_env, &scope) != napi_ok) return nil;

  NSString *result = nil;
  napi_value fn = NULL, recv = NULL, a0 = NULL, a1 = NULL, ret = NULL;

  if (napi_get_reference_value(g_env, g_handler, &fn) == napi_ok && fn != NULL) {
    napi_get_undefined(g_env, &recv);
    napi_create_string_utf8(g_env, command.UTF8String ?: "", NAPI_AUTO_LENGTH, &a0);
    napi_create_string_utf8(g_env, arg.UTF8String ?: "", NAPI_AUTO_LENGTH, &a1);
    napi_value argv[2] = { a0, a1 };

    napi_status st = napi_call_function(g_env, recv, fn, 2, argv, &ret);
    if (st == napi_ok && ret != NULL) {
      size_t len = 0;
      if (napi_get_value_string_utf8(g_env, ret, NULL, 0, &len) == napi_ok) {
        char *buf = (char *)malloc(len + 1);
        if (buf != NULL) {
          if (napi_get_value_string_utf8(g_env, ret, buf, len + 1, &len) == napi_ok) {
            result = [NSString stringWithUTF8String:buf];
          }
          free(buf);
        }
      }
    } else {
      // Clear any pending JS exception so we don't tear down the process.
      bool pending = false;
      napi_is_exception_pending(g_env, &pending);
      if (pending) {
        napi_value err = NULL;
        napi_get_and_clear_last_exception(g_env, &err);
      }
    }
  }

  napi_close_handle_scope(g_env, scope);
  return result;
}

// --- Cocoa Scripting: command handler on the application ---------------------

@interface NSApplication (BibliophileScripting)
@end

@implementation NSApplication (BibliophileScripting)
- (id)handleBibliophileQueryCommand:(NSScriptCommand *)command {
  NSString *arg = nil;
  id direct = [command directParameter];
  if ([direct isKindOfClass:[NSString class]]) arg = (NSString *)direct;
  NSString *res = BPCallJS(@"query", arg ?: @"");
  return res ?: @"";
}
@end

// --- N-API surface -----------------------------------------------------------

// setHandler(fn): register the JS function the command handlers call into.
static napi_value SetHandler(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

  g_env = env;
  if (g_handler != NULL) {
    napi_delete_reference(env, g_handler);
    g_handler = NULL;
  }
  if (argc >= 1) {
    napi_create_reference(env, argv[0], 1, &g_handler);
  }

  napi_value undef;
  napi_get_undefined(env, &undef);
  return undef;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "setHandler", NAPI_AUTO_LENGTH, SetHandler, NULL, &fn);
  napi_set_named_property(env, exports, "setHandler", fn);
  return exports;
}
