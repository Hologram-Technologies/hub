Feature: apex

  @HK-30 @build
  Scenario: Every command the model page gives a tool is one whose requests the apex routes to this repository, so the site never offers a command that reaches nothing
    Given the route record in deploy/caddy/gethologram.ai.caddy, with its comments removed, and the site's model as generated
    When every command the site prints is read: each command, each entry of commands and each tool row
    Then the record sends the Hugging Face dialect to this repository's edge and routes nothing to /v2
    And every server the record proxies to is this repository's edge, Spaces or site
    And no command needs /v2, as an OCI or Ollama client does
    And every curl the site prints at the apex asks for a path the edge or the object store answers
