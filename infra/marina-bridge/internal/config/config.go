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
	Enabled bool   `yaml:"enabled"`
	Broker  string `yaml:"broker"`
	VrmID   string `yaml:"vrm_id"`
}

type YdwgConfig struct {
	Enabled bool   `yaml:"enabled"`
	Address string `yaml:"address"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var c Config
	if err := yaml.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	if c.Slug == "" {
		return nil, fmt.Errorf("slug is required")
	}
	if c.Marina.Broker == "" || c.Marina.Topic == "" {
		return nil, fmt.Errorf("marina.broker and marina.topic are required")
	}
	if c.PublishInterval == 0 {
		c.PublishInterval = 30 * time.Second
	}
	if c.Sources.Cerbo.Enabled && (c.Sources.Cerbo.Broker == "" || c.Sources.Cerbo.VrmID == "") {
		return nil, fmt.Errorf("cerbo source requires broker and vrm_id")
	}
	if c.Sources.Ydwg.Enabled && c.Sources.Ydwg.Address == "" {
		return nil, fmt.Errorf("ydwg source requires address")
	}
	return &c, nil
}
