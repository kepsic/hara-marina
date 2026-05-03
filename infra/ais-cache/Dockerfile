FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ais-cache .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/ais-cache /ais-cache
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/ais-cache"]
