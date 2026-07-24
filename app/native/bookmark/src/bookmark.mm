/**
 * macOS platform shims for BibDesk file parity. (The binary is still named
 * `bibliophile_bookmark` after its first job; renaming it would churn the build
 * scripts, packaging and CI for no functional gain.)
 *
 * BibDesk stores each linked file as a binary plist holding a portable
 * `relativePath` AND a macOS `bookmark` — security-scoped NSData produced by
 * `-[NSURL bookmarkDataWithOptions:includingResourceValuesForKeys:relativeToURL:error:]`
 * (BDSKLinkedFile.m:330). The bookmark is BibDesk's last-resort fallback for
 * finding a file that has moved out from under its relative path: it tracks the
 * file by identity, so a rename or a move within a volume still resolves.
 *
 * Node has no equivalent API, so writing BibDesk-compatible attachments needs
 * this shim. It deliberately mirrors BibDesk's call exactly — same options (0,
 * i.e. no security scope), no resource keys, no relative base — so the blobs we
 * write are the same shape BibDesk writes and reads.
 *
 * `resolve` exists so the round-trip can be tested for real: create a bookmark,
 * resolve it back, and assert it lands on the same file (including after the
 * file has been renamed, which is the whole point of storing one).
 */

#import <Foundation/Foundation.h>
#include <node_api.h>
#include <copyfile.h>
#include <cerrno>
#include <cstring>
#include <string>

/** Wrap an NSError into a JS-visible message, or "" when there was none. */
static NSString *ErrText(NSError *err) {
  return err ? [err localizedDescription] : @"";
}

/**
 * create(path: string) -> Buffer | null
 * Bookmark data for an existing file, or null if the URL can't be bookmarked
 * (missing file, unreadable volume). Never throws into JS.
 */
static napi_value Create(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) return nullptr;

  size_t len = 0;
  napi_get_value_string_utf8(env, argv[0], nullptr, 0, &len);
  std::string path(len, '\0');
  napi_get_value_string_utf8(env, argv[0], &path[0], len + 1, &len);

  __block napi_value result = nullptr;
  @autoreleasepool {
    NSString *p = [NSString stringWithUTF8String:path.c_str()];
    NSURL *url = [NSURL fileURLWithPath:p];
    NSError *err = nil;
    // Options 0 + no resource keys + no relative base: byte-for-byte the same
    // call BibDesk makes, so the resulting blob is interchangeable with its own.
    NSData *data = [url bookmarkDataWithOptions:0
                 includingResourceValuesForKeys:nil
                                  relativeToURL:nil
                                          error:&err];
    if (data == nil) {
      NSLog(@"[bookmark] create failed for %@: %@", p, ErrText(err));
      napi_get_null(env, &result);
    } else {
      void *copy = nullptr;
      napi_create_buffer_copy(env, [data length], [data bytes], &copy, &result);
    }
  }
  return result;
}

/**
 * resolve(data: Buffer) -> string | null
 * The current filesystem path a bookmark points at, following moves/renames.
 */
static napi_value Resolve(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) return nullptr;

  void *bytes = nullptr;
  size_t len = 0;
  if (napi_get_buffer_info(env, argv[0], &bytes, &len) != napi_ok || len == 0) {
    napi_value null_v;
    napi_get_null(env, &null_v);
    return null_v;
  }

  napi_value result = nullptr;
  @autoreleasepool {
    NSData *data = [NSData dataWithBytes:bytes length:len];
    NSError *err = nil;
    BOOL stale = NO;
    NSURL *url = [NSURL URLByResolvingBookmarkData:data
                                           options:NSURLBookmarkResolutionWithoutUI |
                                                   NSURLBookmarkResolutionWithoutMounting
                                     relativeToURL:nil
                               bookmarkDataIsStale:&stale
                                             error:&err];
    if (url == nil) {
      napi_get_null(env, &result);
    } else {
      const char *utf8 = [[url path] UTF8String];
      napi_create_string_utf8(env, utf8, NAPI_AUTO_LENGTH, &result);
    }
  }
  return result;
}

/** Read a JS string argument into a std::string. */
static std::string ArgString(napi_env env, napi_value v) {
  size_t len = 0;
  napi_get_value_string_utf8(env, v, nullptr, 0, &len);
  std::string s(len, '\0');
  napi_get_value_string_utf8(env, v, &s[0], len + 1, &len);
  return s;
}

/**
 * copyFile(src: string, dst: string) -> string | null
 * Copy preserving EVERYTHING: data, extended attributes (Finder tags and
 * comments, quarantine flags), ACLs and resource forks. Node's copyFileSync
 * copies only the bytes, so an attachment copied by it silently loses the tags a
 * user filed it under.
 *
 * COPYFILE_EXCL keeps the never-clobber guarantee the callers rely on: this
 * fails rather than overwriting an existing destination.
 *
 * Returns null on success, or an error message.
 */
static napi_value CopyFile(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_value result = nullptr;
  if (argc < 2) {
    napi_create_string_utf8(env, "copyFile needs src and dst", NAPI_AUTO_LENGTH, &result);
    return result;
  }
  const std::string src = ArgString(env, argv[0]);
  const std::string dst = ArgString(env, argv[1]);

  if (copyfile(src.c_str(), dst.c_str(), nullptr, COPYFILE_ALL | COPYFILE_EXCL) == 0) {
    napi_get_null(env, &result);
  } else {
    napi_create_string_utf8(env, strerror(errno), NAPI_AUTO_LENGTH, &result);
  }
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value create_fn, resolve_fn, copy_fn;
  napi_create_function(env, "create", NAPI_AUTO_LENGTH, Create, nullptr, &create_fn);
  napi_set_named_property(env, exports, "create", create_fn);
  napi_create_function(env, "resolve", NAPI_AUTO_LENGTH, Resolve, nullptr, &resolve_fn);
  napi_set_named_property(env, exports, "resolve", resolve_fn);
  napi_create_function(env, "copyFile", NAPI_AUTO_LENGTH, CopyFile, nullptr, &copy_fn);
  napi_set_named_property(env, exports, "copyFile", copy_fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
