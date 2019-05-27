{
  "targets": [{
    "target_name": "tiny_core",
    "include_dirs": [
    ],
    "sources": [
      "./addon/tiny_core.c"
    ],
    "xcode_settings": {
      "OTHER_CFLAGS": [
        "-O3",
        "-std=c99",
        "-Wall",
        "-D_GNU_SOURCE"
      ]
    },
    "cflags": [
      "-O3",
      "-std=c99",
      "-Wall",
      "-D_GNU_SOURCE"
    ],
    "conditions": [
      ['OS=="win"', {
        "link_settings": {
          "libraries": [
            "-lws2_32.lib"
          ]
        }
      }]
    ],
  }]
}
