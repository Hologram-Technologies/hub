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

  @HK-29 @build
  Scenario: The index learns which other sources hold a release only from the holders record this repository carries, and only for the revision that record names, so a build reads no other hub
    Given the index builder in tools/index.mjs, with its comments removed, and sources/holders.json
    When the builder looks for the other sources that hold a release
    Then it reads them from sources/holders.json, names no other hub, and takes an entry only when its revision is the release's
    And every entry in the record names its revision, the hash of the file it was read from, and each source's kind, resolve base and missing files
    And the index's signed predicate names that record as where its holders came from

  @HK-35 @build
  Scenario: Every safetensors file in the UOR address index is addressed by uor-addr's safetensors realization, and each of its tensors carries the BLAKE3 leaf the file's label binds, which is its address, and the byte range that leaf was taken over, so a reader checks one tensor from a ranged read
    Given a UOR address index built by tools/uor-index.mjs from a model with safetensors files
    When uor-label mints a safetensors file through uor-addr's safetensors entry points
    Then the row says it is the safetensors realization and the root names that realization's canonical form
    And every tensor carries its uor-addr leaf and the byte range of the file that leaf is the SHA-256 of

  @HK-44 @build
  Scenario: Every tensor longer than 1 MiB in the UOR address index has a piece table, published under the tensor's address, that folds to that address, so a reader checks each piece of the tensor as it arrives
    Given uor-label, which checks each tensor's leaf through its piece tree, and tools/uor-index.mjs
    When the Pages workflow builds the UOR index and runs tests/uor/index.mjs on it
    Then every tensor over 1 MiB has a table under its address that folds to that address, and no other table is published

  @HK-51 @build
  Scenario: Every file manifests/onnx.txt lists carries, in its release record, the BLAKE3 of the whole file's bytes, and the index root names every record and browse shard by BLAKE3 beside SHA-256, so a reader checks a record and a file without SHA-256
    Given manifests/onnx.txt, which names the q4 and q4f16 graphs, their external data and the four JSON files of the five exports Hologram AI loads
    When tools/index.mjs builds the index and the Pages workflow runs tests/index/shards.mjs on it
    Then every listed file carries in its record the BLAKE3 of its whole bytes, streamed from the release and refused unless they are the bytes the record already describes
    And the root names every record, browse shard and the catalog by BLAKE3 beside SHA-256, and a record changed by one byte is refused by its BLAKE3
    And a listed path the release does not hold stops the build

  @HK-52 @build
  Scenario: Every initializer of an ONNX graph manifests/onnx.txt lists is in the UOR address index with its name, data type and dims, the file its bytes lie in, their offset and length there, and an address that is the BLAKE3 of exactly those bytes, so a reader checks one tensor from a ranged read
    Given the ONNX graphs manifests/onnx.txt lists, each with its record's BLAKE3 for every file it reads
    When tools/uor-index.mjs reads each graph and its external data through tools/onnx.mjs and the Pages workflow runs tests/uor/index.mjs
    Then every initializer is a row tensor with its name, data type, shape, file, offset, length and the BLAKE3 of exactly those bytes as its address
    And a file whose bytes are not the BLAKE3 its record names, typed data, a length the dims do not make and a location outside the repository are each refused
    And one tensor in every file, read by range from where the row says its bytes came from, hashes to its address, and no ONNX row names content by SHA-256
