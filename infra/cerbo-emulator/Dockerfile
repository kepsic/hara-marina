# Multi-stage build: tiny final image (~12 MB).
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/cerbo-emulator .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/cerbo-emulator /cerbo-emulator
USER nonroot:nonroot
ENTRYPOINT ["/cerbo-emulator"]
