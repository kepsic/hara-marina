package config

import (
	"fmt"
	"os"
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
		Cerbo CerboConfig `yaml:"cerbo"`
		Ydwg  YdwgConfig  `yaml:"ydwg"`
	} `yaml:"sources"`
}

type CerboConfig struct {
	Enabled  bool   `yaml:"enabled"`
	Broker   string `yaml:"broker"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
	VrmID    string `yaml:"vrm_id"`
}

type YdwgConfig struct {
	Enabled bool   `yaml:"enabled"`
	Address string `yaml:"address"`
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
	if c.Sources.Ydwg.Enabled && c.Sources.Ydwg.Address == "" {
		return nil, fmt.Errorf("ydwg source requires address")
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
	if v := os.Getenv("YDWG_ADDRESS"); v != "" {
		c.Sources.Ydwg.Address = v
	}
}
