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
