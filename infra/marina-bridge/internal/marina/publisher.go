package marina

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

// Publisher wraps the Paho client for talking to the marina broker.
type Publisher struct {
	client mqtt.Client
	topic  string
}

func NewPublisher(broker, username, password, topic, clientID string) (*Publisher, error) {
	opts := mqtt.NewClientOptions().
		AddBroker(broker).
		SetClientID(clientID).
		SetUsername(username).
		SetPassword(password).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second).
		SetMaxReconnectInterval(60 * time.Second).
		SetKeepAlive(30 * time.Second).
		SetCleanSession(true).
		SetOnConnectHandler(func(c mqtt.Client) {
			log.Printf("[marina] connected to %s as %s", broker, username)
		}).
		SetConnectionLostHandler(func(c mqtt.Client, err error) {
			log.Printf("[marina] connection lost: %v", err)
		})
	if strings.HasPrefix(broker, "ssl://") || strings.HasPrefix(broker, "tls://") || strings.HasPrefix(broker, "mqtts://") {
		opts.SetTLSConfig(&tls.Config{MinVersion: tls.VersionTLS12})
	}
	client := mqtt.NewClient(opts)
	if t := client.Connect(); t.WaitTimeout(20*time.Second) && t.Error() != nil {
		return nil, fmt.Errorf("connect: %w", t.Error())
	}
	return &Publisher{client: client, topic: topic}, nil
}

// Publish sends one telemetry document to the marina topic at QoS 0.
func (p *Publisher) Publish(ctx context.Context, doc map[string]any) error {
	body, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	t := p.client.Publish(p.topic, 0, false, body)
	select {
	case <-t.Done():
		return t.Error()
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *Publisher) Close() {
	if p.client.IsConnected() {
		p.client.Disconnect(500)
	}
}
