Feature: pieces

  The browser fetcher in web/pieces.mjs: a model's bytes, fetched in 1 MiB
  pieces from any host that answers a Range request, and each piece used only
  when the kernel's piece rule says so. Lean proves the rule (HK-39 to HK-42);
  the fetcher transcribes it and is checked against it.

  @HK-43 @build
  Scenario: A model's bytes are fetched in pieces from any host, and a piece is used only when the fetcher's decision, the kernel's piece rule, answers reuse or deliver; that decision keeps HK-39 to HK-42 on every input, and the committed hasher is what its source builds
    Given the fetcher in web/pieces.mjs and the kernel's rule in app/src/Pieces.lex.tex
    When the pieces workflow rebuilds web/piece-hash.wasm and runs tests/pieces/fetch.mjs
    Then every piece used was answered reuse or deliver, on every input and against hosts that lie, truncate and fail
