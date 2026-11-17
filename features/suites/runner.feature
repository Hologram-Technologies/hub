Feature: runner

  @HK-36 @build
  Scenario: The runner checks a file it serves from its cache against the file's address and every tensor's address on every read, as it checks a fresh fetch, and a cached file that fails is deleted and fetched again rather than served
    Given a file the runner has already fetched, checked and cached
    When one byte of the cached copy changes on disk and a client asks for the file again
    Then the runner checks the cached copy as it checks a fresh fetch, deletes it, and fetches the file again
    And the client receives the file the record addresses, never the changed copy

  @HK-37 @build
  Scenario: When every source sends bytes that do not match the address, the runner refuses with Quarantined, naming the address it expected and the one it got, so a client can tell bad bytes from an outage
    Given a request whose only usable source sends bytes that are not the file
    When the runner has compared them with the address and no source is left
    Then it refuses with 502 Quarantined rather than 503 NoSource
    And the refusal names the address it expected and the one the bytes had
    And a file with no address to compare against is still refused as NoSource
