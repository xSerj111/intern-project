#!/bin/sh
# Renders the S3 identities file from the same S3_* variables the core service
# reads, then starts master, volume, filer and S3 gateway in one process.
set -eu

: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"

mkdir -p /etc/seaweedfs
cat > /etc/seaweedfs/s3.json <<EOF
{"identities":[
  {"name":"admin","credentials":[{"accessKey":"${S3_ACCESS_KEY}","secretKey":"${S3_SECRET_KEY}"}],"actions":["Admin","Read","Write","List","Tagging"]},
  {"name":"anonymous","actions":["Read:innogram-assets"]}
]}
EOF

# volume.max: the default of 8 volumes is exhausted by the first few buckets.
exec weed server -dir=/data -volume.max=100 -s3 -s3.config=/etc/seaweedfs/s3.json -s3.port=8333
