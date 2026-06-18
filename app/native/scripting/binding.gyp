{
  "targets": [
    {
      "target_name": "bibliophile_scripting",
      "sources": [ "src/scripting.mm" ],
      "conditions": [
        [ "OS=='mac'", {
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "11.0"
          },
          "link_settings": {
            "libraries": [
              "-framework Foundation",
              "-framework AppKit"
            ]
          }
        } ]
      ]
    }
  ]
}
