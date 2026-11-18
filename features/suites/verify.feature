Feature: verify

  @HK-38 @build
  Scenario: A downloaded model file is checked against the UOR address index by a verifier that uses only the Python standard library: it recomputes the file's canonical label and every tensor's leaf, and refuses the file naming each tensor that does not match
    Given a safetensors file and a GGUF file whose rows uor-label wrote into a UOR address index
    When web/uor-verify.py checks them using only the Python standard library
    Then it accepts both, recomputing each file's label and every tensor's leaf
    And it refuses a flipped tensor byte naming that tensor, a changed metadata value by the label, and a shard that is not the bytes the root names
