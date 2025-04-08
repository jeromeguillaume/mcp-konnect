docker rm -f mcpo-konnect

export ARCHITECTURE=arm64

# Start MCP Konnect
docker run -d --name mcpo-konnect \
-p 3080:3080 \
-e "KONNECT_ACCESS_TOKEN=$KONNECT_ACCESS_TOKEN" \
-e "KONNECT_REGION=eu" \
--platform linux/$ARCHITECTURE \
jeromeguillaume386/mcpo-konnect:1.0.0

echo 'docker logs mcpo-konnect -f'