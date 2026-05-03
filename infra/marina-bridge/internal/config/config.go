package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Slug            string        `yaml:"slug"`
	PublishInterval time.Duration `yaml:"publish_interval"`

	Marina struct {
		Broker   string `yaml:"broker"`
		Username string `yaml:"username"`
		Password string `yaml:"password"`
		Topic    string `yaml:"topic"`
	} `yaml:"marina"`

	Sources struct {
		Cerbo  CerboConfig  `yaml:"cerbo"`
		Ydwg   YdwgConfig   `yaml:"ydwg"`
		N0183  N0183Config  `yaml:"n0183"`
		Emtrak EmtrakConfig `yaml:"emtrak"`
	} `yaml:"sources"`

	AisIngest AisIngestConfig `yaml:"ais_ingest"`
}

// AisIngestConfig: when enabled, every AIS position decoded from the boat's
// own NMEA 2000 bus (via YDWG) is POSTed to the central ais-cache service.
// This bypasses AISStream entirely so we capture our own boat regardless of
// shore-receiver coverage.
type AisIngestConfig struct {
	Enabled bool   `yaml:"enabled"`
	URL     string `yaml:"url"`   // e.g. https://ais-cache-production.up.railway.app
	Token   string `yaml:"token"` // bearer token for the cache service
	MMSI    string `yaml:"mmsi"`  // this boat's MMSI; used as fallback if not in N2K frame
	Name    string `yaml:"name"`  // optional friendly name forwarded to cache
}

type CerboConfig struct {
	Enabled  bool   `yaml:"enabled"`
	Broker   string `yaml:"broker"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
	VrmID    string `yaml:"vrm_id"`
}

// YdwgConfig: receive RAW NMEA 2000 frames from a Yacht Devices gateway
// (YDWG-02 / YDEN-02 / YDNR-02 Server #2 in TCP/RAW mode).
//
// Two transport modes:
//
//	client (default): bridge dials Address and reads frames
//	server:           bridge LISTENS on Listen and accepts the gateway's
//	                  outgoing connection (use YDNR "Enable the outgoing
//	                  connection" with Server #2 set to TCP/RAW)
type YdwgConfig struct {
	Enabled bool   `yaml:"enabled"`
	Mode    string `yaml:"mode"`    // client|server (default client)
	Address string `yaml:"address"` // host:port for client mode
	Listen  string `yaml:"listen"`  // host:port for server mode (e.g. :1457)
}

// N0183Config: read NMEA 0183 sentences from a TCP server (line-oriented,
// CRLF/LF terminated). Suitable for the YDNR-02 Server #1 (default port 1456,
// data protocol "NMEA 0183"), or any plotter/multiplexer that exposes a TCP
// 0183 stream.
type N0183Config struct {
	Enabled bool   `yaml:"enabled"`
	Address string `yaml:"address"`
}

// EmtrakConfig: connect to an em-trak B-class transponder. The same NMEA 0183
// stream is exposed over both the built-in WiFi access point (TCP
// 192.168.1.1:39150) and the USB-B port (CDC-ACM serial, 38400 baud).
//
// Mode selects the transport:
//
//	"auto"   (default) probe USB serial paths first, fall back to TCP
//	"serial" serial only (SerialDevice required, or autodiscover /dev/ttyACM*)
//	"tcp"    TCP only (Address required, default 192.168.1.1:39150)
type EmtrakConfig struct {
	Enabled      bool   `yaml:"enabled"`
	Mode         string `yaml:"mode"`          // auto|serial|tcp (default auto)
	Address      string `yaml:"address"`       // host:port for tcp/auto
	SerialDevice string `yaml:"serial_device"` // explicit serial path; empty = probe
	SerialBaud   int    `yaml:"serial_baud"`   // default 38400
}

func Load(path string) (*Config, error) {
	var c Config
	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil && !os.IsNotExist(err) {
			return nil, fmt.Errorf("read config: %w", err)
		}
		if err == nil {
			if err := yaml.Unmarshal(data, &c); err != nil {
				return nil, fmt.Errorf("parse config: %w", err)
			}
		}
	}
	applyEnv(&c)
	if c.Slug == "" {
		return nil, fmt.Errorf("slug is required (set BRIDGE_SLUG or yaml slug)")
	}
	if c.Marina.Broker == "" || c.Marina.Topic == "" {
		return nil, fmt.Errorf("marina.broker and marina.topic are required")
	}
	if c.PublishInterval == 0 {
		c.PublishInterval = 30 * time.Second
	}
	if c.Sources.Cerbo.Enabled && c.Sources.Cerbo.Broker == "" {
		return nil, fmt.Errorf("cerbo source requires broker (vrm_id may be empty or \"auto\")")
	}
	if c.Sources.Ydwg.Enabled {
		if c.Sources.Ydwg.Mode == "" {
			c.Sources.Ydwg.Mode = "client"
		}
		switch c.Sources.Ydwg.Mode {
		case "client":
			if c.Sources.Ydwg.Address == "" {
				return nil, fmt.Errorf("ydwg client mode requires address")
			}
		case "server":
			if c.Sources.Ydwg.Listen == "" {
				return nil, fmt.Errorf("ydwg server mode requires listen address")
			}
		default:
			return nil, fmt.Errorf("ydwg.mode must be client or server (got %q)", c.Sources.Ydwg.Mode)
		}
	}
	if c.Sources.N0183.Enabled && c.Sources.N0183.Address == "" {
		return nil, fmt.Errorf("n0183 source requires address")
	}
	if c.Sources.Emtrak.Enabled {
		if c.Sources.Emtrak.Mode == "" {
			c.Sources.Emtrak.Mode = "auto"
		}
		if c.Sources.Emtrak.Address == "" {
			c.Sources.Emtrak.Address = "192.168.1.1:39150"
		}
		if c.Sources.Emtrak.SerialBaud == 0 {
			c.Sources.Emtrak.SerialBaud = 38400
		}
		switch c.Sources.Emtrak.Mode {
		case "auto", "serial", "tcp":
		default:
			return nil, fmt.Errorf("emtrak.mode must be auto, serial or tcp (got %q)", c.Sources.Emtrak.Mode)
		}
		if c.Sources.Emtrak.Mode == "tcp" && c.Sources.Emtrak.Address == "" {
			return nil, fmt.Errorf("emtrak source in tcp mode requires address (host:port)")
		}
	}
	return &c, nil
}

func applyEnv(c *Config) {
	if v := os.Getenv("BRIDGE_SLUG"); v != "" {
		c.Slug = v
	}
	if v := os.Getenv("BRIDGE_PUBLISH_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			c.PublishInterval = d
		}
	}
	if v := os.Getenv("MARINA_BROKER"); v != "" {
		c.Marina.Broker = v
	}
	if v := os.Getenv("MARINA_USERNAME"); v != "" {
		c.Marina.Username = v
	}
	if v := os.Getenv("MARINA_PASSWORD"); v != "" {
		c.Marina.Password = v
	}
	if v := os.Getenv("MARINA_TOPIC"); v != "" {
		c.Marina.Topic = v
	}
	if v := os.Getenv("CERBO_ENABLED"); v == "true" || v == "1" {
		c.Sources.Cerbo.Enabled = true
	}
	if v := os.Getenv("CERBO_BROKER"); v != "" {
		c.Sources.Cerbo.Broker = v
	}
	if v := os.Getenv("CERBO_USERNAME"); v != "" {
		c.Sources.Cerbo.Username = v
	}
	if v := os.Getenv("CERBO_PASSWORD"); v != "" {
		c.Sources.Cerbo.Password = v
	}
	if v := os.Getenv("CERBO_VRM_ID"); v != "" {
		c.Sources.Cerbo.VrmID = v
	}
	if v := os.Getenv("YDWG_ENABLED"); v == "true" || v == "1" {
		c.Sources.Ydwg.Enabled = true
	}
	if v := os.Getenv("YDWG_MODE"); v != "" {
		c.Sources.Ydwg.Mode = v
	}
	if v := os.Getenv("YDWG_ADDRESS"); v != "" {
		c.Sources.Ydwg.Address = v
	}
	if v := os.Getenv("YDWG_LISTEN"); v != "" {
		c.Sources.Ydwg.Listen = v
	}
	if v := os.Getenv("N0183_ENABLED"); v == "true" || v == "1" {
		c.Sources.N0183.Enabled = true
	}
	if v := os.Getenv("N0183_ADDRESS"); v != "" {
		c.Sources.N0183.Address = v
	}
	if v := os.Getenv("EMTRAK_ENABLED"); v == "true" || v == "1" {
		c.Sources.Emtrak.Enabled = true
	}
	if v := os.Getenv("EMTRAK_ADDRESS"); v != "" {
		c.Sources.Emtrak.Address = v
	}
	if v := os.Getenv("EMTRAK_MODE"); v != "" {
		c.Sources.Emtrak.Mode = v
	}
	if v := os.Getenv("EMTRAK_SERIAL_DEVICE"); v != "" {
		c.Sources.Emtrak.SerialDevice = v
	}
	if v := os.Getenv("EMTRAK_SERIAL_BAUD"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.Sources.Emtrak.SerialBaud = n
		}
	}
	if v := os.Getenv("AIS_INGEST_ENABLED"); v == "true" || v == "1" {
		c.AisIngest.Enabled = true
	}
	if v := os.Getenv("AIS_INGEST_URL"); v != "" {
		c.AisIngest.URL = v
	}
	if v := os.Getenv("AIS_INGEST_TOKEN"); v != "" {
		c.AisIngest.Token = v
	}
	if v := os.Getenv("AIS_INGEST_MMSI"); v != "" {
		c.AisIngest.MMSI = v
	}
	if v := os.Getenv("AIS_INGEST_NAME"); v != "" {
		c.AisIngest.Name = v
	}
}
