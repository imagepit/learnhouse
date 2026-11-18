FROM --platform=linux/arm64 debian:bookworm-slim AS isolate
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gcc libc6-dev libcap-dev libseccomp-dev make pkg-config
WORKDIR /src
RUN curl -fsSL https://codeload.github.com/ioi/isolate/tar.gz/refs/tags/v2.4 -o /tmp/isolate.tar.gz \
    && echo 'e15c4e66d2049964e094efeb4299f88af894c97f233c4b8cd6502010ca9bd01e  /tmp/isolate.tar.gz' | sha256sum -c - \
    && tar -xzf /tmp/isolate.tar.gz --strip-components=1 \
    && make isolate LDFLAGS=-static

FROM --platform=linux/arm64 python:3.12.16-alpine AS python
FROM --platform=linux/amd64 judge0/judge0:1.13.1
USER root
COPY --from=isolate --chmod=4755 /src/isolate /usr/local/bin/isolate
COPY --from=python /usr/local/ /usr/local/core241-native/python/
COPY --from=python /lib/ /usr/local/core241-native/lib/
COPY --from=python /usr/lib/ /usr/local/core241-native/usr-lib/
COPY --from=python /bin/busybox /usr/local/core241-native/busybox
COPY python-arm64.patch /tmp/python-arm64.patch
RUN mkdir -p /run/isolate/locks \
    && printf '\nlock_root = /run/isolate/locks\n' >> /usr/local/etc/isolate \
    && patch -p1 -i /tmp/python-arm64.patch \
    && ruby -c app/jobs/isolate_job.rb \
    && rm /tmp/python-arm64.patch
USER judge0
