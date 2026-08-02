# Third-Party Notices

LifeDash itself is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE)
— source-available, free for personal and noncommercial use. That license covers
LifeDash's own code only.

LifeDash redistributes the third-party components listed below in binary form. Each
one remains under its own license, reproduced in full here, and nothing in
LifeDash's license restricts your rights to them.

This file covers components LifeDash ships as **binaries**. JavaScript dependencies
installed and bundled through npm remain under their own licenses; the authoritative
list of those is `package-lock.json`.

---

## llama.cpp

Used for the optional built-in local AI runtime (`llama-server`). LifeDash ships the
official prebuilt release binaries from `ggml-org/llama.cpp`, unmodified, pinned to
one release tag and verified by sha256 at build time.

- Project: <https://github.com/ggml-org/llama.cpp>
- Release tag shipped: `b10219`
- Assets redistributed (each staged under `resources/llama/<backend>/`, with its
  recorded checksum in that directory's `provenance.json`):
  - `llama-b10219-bin-win-vulkan-x64.zip` — sha256 `a63bd0ceab781483a7fde174f1676d86c9724d7376d721fab026fa2df1393997`
  - `llama-b10219-bin-win-cpu-x64.zip` — sha256 `5f3fc78e61d7402f7051c3580159c8a12ff6cb98912e42f4272932e1afb7f882`
  - `llama-b10219-bin-macos-arm64.tar.gz` — sha256 `b54af3c25a3ded15fc0f7a5a0898a65f1a9beb63981a93e0ae93f648811fb960`

```
MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## whisper.node (whisper.cpp bindings)

Used for on-device transcription. LifeDash ships `@fugood/whisper.node` and its
platform binary packages (`@fugood/node-whisper-*`), all declared MIT.

- Project: <https://github.com/fugood/whisper.node>
- Upstream: whisper.cpp — <https://github.com/ggml-org/whisper.cpp>

```
MIT License

Copyright (c) 2025 ggml / whisper.cpp contributors
Copyright (c) 2025 Jhen-Jie Hong <developer@jhen.me>
Copyright (c) 2025 Hans Chen <hans.chen@bricks.tools>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Model weights

LifeDash ships **no model weights**. Whisper and local-AI models are downloaded on
demand, at your request, from their original hosts (Hugging Face). Each model
carries its own license from its own publisher — check the model card before using
one commercially.
