Feature: kernel

  The hub kernel, in app/: from the facts a runner gathered about one file
  request, it decides the answer, the source and the ETag kind; given an expected
  and an observed digest and size, it decides whether received bytes may be
  delivered. Every claim below is a theorem Lean proves for every input.

  @HK-01 @build
  Scenario: A missing repository and a private repository get the same answer: repository not found, with no source and no ETag
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks privacyHolds in app/src/Proofs/Privacy.lex.tex during prismpm verify
    Then no input meets breaksPrivacy

  @HK-02 @build
  Scenario: The kernel delivers a file only for a public repository at a resolved revision whose entry exists, and names a source and an ETag exactly when it delivers
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks deliveryHolds in app/src/Proofs/Delivery.lex.tex during prismpm verify
    Then no input meets breaksDelivery

  @HK-03 @build
  Scenario: The edge runner only ever redirects and the local runner only ever serves
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks runnerHolds in app/src/Proofs/Runner.lex.tex during prismpm verify
    Then no input meets breaksRunner

  @HK-04 @build
  Scenario: The edge runner never redirects to a source that is not vetted
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks vettedHolds in app/src/Proofs/Vetted.lex.tex during prismpm verify
    Then no input meets breaksVetted

  @HK-05 @build
  Scenario: A delivered file always has a source, and the kernel never chooses a source that does not hold the file or that failed verification for it
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks sourcedHolds in app/src/Proofs/Sourced.lex.tex during prismpm verify
    And the Lean kernel checks soundHolds in app/src/Proofs/Sound.lex.tex during prismpm verify
    Then no input meets breaksSourced
    And no input meets breaksSound

  @HK-06 @build
  Scenario: A pinned source is the only source the kernel may choose
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks pinHolds in app/src/Proofs/Pin.lex.tex during prismpm verify
    Then no input meets breaksPin

  @HK-07 @build
  Scenario: Without a pin, the kernel chooses a healthy source whenever a usable one exists
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks healthyHolds in app/src/Proofs/Healthy.lex.tex during prismpm verify
    Then no input meets breaksHealthy

  @HK-08 @build
  Scenario: A delivered small file carries the git blob ETag and a delivered large file carries the SHA-256 ETag
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks etagHolds in app/src/Proofs/Etag.lex.tex during prismpm verify
    Then no input meets breaksEtag

  @HK-09 @build
  Scenario: A commit prefix resolves only when it is 7 to 40 characters long and matches the release's commit
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks revisionHolds in app/src/Proofs/Revision.lex.tex during prismpm verify
    Then no input meets breaksRevision

  @HK-16 @build
  Scenario: Every filter the browse page offers maps to one query parameter and back, so a link carries the whole state
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks queryHolds in app/src/Proofs/Query.lex.tex during prismpm verify
    Then no input meets breaksQuery

  @HK-11 @build
  Scenario: Every header item and every link that stays in the hub opens a screen the kernel renders
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks navHolds in app/src/Proofs/Nav.lex.tex during prismpm verify
    And the Lean kernel checks linksHold in app/src/Proofs/Links.lex.tex during prismpm verify
    Then no input meets breaksNav
    And no input meets breaksLinks

  @HK-12 @build
  Scenario: A Hugging Face tool sees no HTTP error exactly when the kernel delivers, and every refusal reaches it as a 4xx or 5xx status with a named error code
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks dialectHolds in app/src/Proofs/Dialect.lex.tex during prismpm verify
    And the Lean kernel checks errorsHold in app/src/Proofs/Errors.lex.tex during prismpm verify
    Then no input meets breaksDialect
    And no input meets breaksErrors

  @HK-13 @build
  Scenario: The page says Verified only when at least one source delivered and none sent other bytes, and any source that sent other bytes makes the verdict a mismatch
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks verdictHolds in app/src/Proofs/Verdict.lex.tex during prismpm verify
    Then no input meets breaksVerdict

  @HK-15 @build
  Scenario: An answer is built from the index only when the record holds every field that answer names; where one is missing the source dialect is asked, and where it cannot be asked the answer says it is partial
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks completeHolds in app/src/Proofs/Complete.lex.tex during prismpm verify
    Then no input meets breaksComplete

  @HK-14 @build
  Scenario: A model page says Witnessed or Published only when every signature check passed, says Published only for a publisher's signature from the namespace owner, and never shows a witness's signature as a publisher's
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks trustHolds in app/src/Proofs/Trust.lex.tex during prismpm verify
    Then no input meets breaksTrust

  @HK-10 @build
  Scenario: Received bytes are delivered exactly when their digest and size equal the expected digest and size
    Given the kernel model in app/src/Kernel.lex.tex
    When the Lean kernel checks acceptsDecides in app/src/Proofs/Accepts.lex.tex during prismpm verify
    Then accepts is true exactly when Accepts holds
