Feature: apex

  @HK-30 @build
  Scenario: Every command the model page gives a tool is one whose requests the apex routes to this repository, so the site never offers a command that reaches nothing
    Given the route record in deploy/caddy/gethologram.ai.caddy, with its comments removed, and the site's model as generated
    When every command the site prints is read: each command, each entry of commands and each tool row
    Then the record sends the Hugging Face dialect to this repository's edge and routes nothing to /v2
    And every server the record proxies to is this repository's edge, Spaces or site
    And no command needs /v2, as an OCI or Ollama client does
    And every curl the site prints at the apex asks for a path the edge or the object store answers

  @HK-33 @build
  Scenario: A tool that asks the apex for its bare name, curl gethologram.ai over http or https, gets a plain-text guide published as a static file and written from the home screen's model, every curl in it reaches a route the apex answers, and the home page prints that command
    Given the route record in deploy/caddy/gethologram.ai.caddy, with its comments removed, the site's model as generated, and web/agent.txt
    When the home screen's command and guide are read from the model
    Then the home screen's command is curl gethologram.ai
    And web/agent.txt is the guide's lines exactly, none wider than 100 columns
    And every curl in the guide asks for a path the edge or the object store answers
    And both the https and the http site blocks send a curl, Wget, HTTPie or xh request for / to the guide on Pages, and vary on User-Agent
    And the http block sends every other request to https

  @HK-34 @build
  Scenario: The landing hero fits every screen from 320 pixels wide: no part of it is wider than the window, so nothing is cut off and the page never scrolls sideways
    Given web/hub.css with its comments removed, and the published-site check in tools/smoke.mjs
    When the landing hero's layout rules are read
    Then the landing and its copy lay out in one column bounded by the window, minmax(0, 1fr)
    And every child of the hero, and the command line, is at most the width of that column
    And the published-site check opens the landing at 320 pixels wide and at desktop widths, and fails if any part of the hero or the page is wider than the window
