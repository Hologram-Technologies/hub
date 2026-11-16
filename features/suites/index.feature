Feature: index

  @HK-18 @build
  Scenario: A release record always carries the fields a client reads: the repository, the revision, every file with its path, size and git blob address, and the sources that hold it
    Given the index builder in tools/index.mjs
    When the record it writes is read, with its comments removed
    Then that record carries repo, revision, files and sources
    And every file entry carries path, size and gitSha1, and sha256 where the source has one

  @HK-20 @build
  Scenario: A release record names where its own bytes come from, and the edge sends a client to that same place, so a reader who is not the edge can fetch and check a file without knowing which hub built the record
    Given a release record built for a repository and a revision
    When a reader that is not the edge wants one of its files
    Then the record names the origin that holds it, as a kind and a resolve base
    And the edge's own redirect for that file is that base with the file's path appended

  @HK-21 @build
  Scenario: A swarm catalog row is filed under the shard key the page resolves a query with, and says it is a listing rather than a checked record, so a search reads one shard and what it draws is not mistaken for proof
    Given a swarm catalog built by tools/swarm-catalog.mjs
    When a reader searches for a model the catalog holds
    Then the shard the page reads is the shard web/swarmkey.mjs filed that row under
    And every row in it carries the state listed and names no source but the swarm

  @HK-23 @build
  Scenario: A suggestion the header offers is filed under the words the page resolves a query with, and a panel the head of the catalogue could not fill says so and is completed from the full index, so a short list is never mistaken for the whole answer
    Given a quicksearch index built by tools/browse-index.mjs
    When the header's box resolves what has been typed
    Then the bucket it reads and the words it matches are web/browsekey.mjs, the rule the builder filed by
    And a panel the head of the catalogue filled says it is complete, and one it could not does not
    And an incomplete panel is completed from the full index rather than left short

  @HK-24 @build
  Scenario: Every row in the UOR address index carries a canonical address and the canonical-form version that minted it, taken here from bytes this build streamed rather than copied from any host, and is filed under the shard key the page resolves a model with
    Given a UOR address index built by tools/uor-index.mjs
    When a reader opens the model one of its rows belongs to
    Then the shard the page reads is the shard web/uorkey.mjs filed that row under
    And every row carries a canonical address and the canonical form that minted it, taken from the bytes this build streamed and not from a field of the record

  @HK-25 @build
  Scenario: The page shows a tensor address as checked only when the kernel accepted bytes the page fetched itself, so an address the hub published is never drawn as proof of bytes nobody read
    Given a model page drawing a tensor's published address
    When a reader asks the page to check that address
    Then the page fetches that tensor's own byte range and asks the kernel's accept rule about the bytes it got
    And the row says it is unchecked until the kernel has answered

  @HK-26 @build
  Scenario: A filter the panel offers is one whatever is driving the list can act on, so a control is never drawn that cannot narrow anything
    Given the browse panel drawn over the roll
    When it decides which facets to offer
    Then it offers a facet the roll counts, or one of the hub's own that moves the page to the records that can answer
    And the list of the hub's own facets is the one list, read by both the deciding and the moving
    And the parameter range is applied to the roll rather than drawn over it
