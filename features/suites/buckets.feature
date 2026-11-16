Feature: buckets

  Objects this hub publishes, each fetched and checked by its own address.

  @HK-28 @build
  Scenario: The object store holds each object only under the SHA-256 of its bytes, every file a published Space is made of is in it, and the address the Buckets page offers as its example is one the store holds
    Given tools/objects.mjs, deploy/spaces/deploy.sh, deploy/caddy/gethologram.ai.caddy and the site as generated in app/src/Site.lex.tex
    When the store is built from a release of the Spaces and the page fetches /api/v1/objects/<address>
    Then every object is filed under the SHA-256 its builder computes from its bytes, and under no other name
    And the store is built from every file of the assembled Spaces, after they are assembled, and Caddy answers the page's path from it
    And the example address the Buckets screen offers is the SHA-256 of a Space manifest this repository carries
