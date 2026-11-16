Feature: spaces

  The Spaces the hub publishes, each a sealed artifact named by the hash of its manifest.

  @HK-27 @build
  Scenario: Every Space the site publishes is the sealed artifact its catalog names: each file hashes to its lock entry, the manifest hashes to the root, and the runtime comes from locked packages whose bytes match the lock too
    Given the catalog in spaces/catalog.json and each Space's holospace.lock.json and manifest.json
    When every file the lock names is found where this repository carries it, or in the package spaces/sources.json pins for it
    Then each one hashes to its lock entry, the manifest's layers name the same files, and the manifest hashes to the root the lock and the catalog give
    And tools/spaces.mjs refuses a tarball that is not its integrity, a file that is not its lock entry, a manifest that is not its root, and a file that is published but not locked
