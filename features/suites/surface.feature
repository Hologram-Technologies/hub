Feature: surface

  @HK-31 @build
  Scenario: Every read operation Hugging Face answers a client with no token, for models, datasets and Spaces, is one the hub answers at Hugging Face's own path and in its terms, and none of them is refused
    Given Hugging Face's own published surface, pinned in tools/hf-surface/inventory.json, and the hub's surface table in the site model as generated
    When every read operation tagged models, datasets or spaces, and every read that names a repository type, is looked up in the hub's table
    Then each one is in the table at Hugging Face's own path, for each repository type it names, or is named there as one Hugging Face answers only to the repository's owner
    And the kernel routes every public read in the table to the index, the file decision or Hugging Face, and Lean proves it never refuses one
    And a Hugging Face client reads models, datasets and Spaces through the hub and sees what it sees from huggingface.co

  @HK-32 @build
  Scenario: Every request the hub does not answer as a read is refused as Hugging Face refuses a client with no token: 401 with a Bearer challenge
    Given the kernel's route decision and the dialect the edge answers in
    When a request is a write, an owner-only read, whoami, or a path the table does not hold
    Then the kernel refuses it, and Lean proves that every method the table does not list for an operation is refused
    And the dialect answers that refusal 401 with a Bearer challenge and Hugging Face's own message, as huggingface.co answers a client with no token
