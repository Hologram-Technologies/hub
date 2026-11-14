Feature: index

  @HK-18 @build
  Scenario: A release record always carries the fields a client reads: the repository, the revision, every file with its path, size and git blob address, and the sources that hold it
    Given the index builder in tools/index.mjs
    When the record it writes is read, with its comments removed
    Then that record carries repo, revision, files and sources
    And every file entry carries path, size and gitSha1, and sha256 where the source has one
