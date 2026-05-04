package marina

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

// CommandSubscriber listens for boat command messages on the marina broker.
type CommandSubscriber struct {
	client mqtt.Client
}

func NewCommandSubscriber(broker, username, password, topic, clientID string, handler func(topic string, payload []byte)) (*CommandSubscriber, error) {
	opts := mqtt.NewClientOptions().
		AddBroker(broker).
		SetClientID(clientID).
		SetUsername(username).
		SetPassword(password).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second).
		SetKeepAlive(30 * time.Second).
		SetCleanSession(true).
		SetOnConnectHandler(func(c mqtt.Client) {
			if t := c.Subscribe(topic, 1, func(_ mqtt.Client, m mqtt.Message) {
				handler(m.Topic(), m.Payload())
			}); t.Wait() && t.Error() != nil {
				log.Printf("[marina-cmd] subscribe %s failed: %v", topic, t.Error())
				return
			}
			log.Printf("[marina-cmd] subscribed %s", topic)
		}).
		SetConnectionLostHandler(func(_ mqtt.Client, err error) {
			log.Printf("[marina-cmd] connection lost: %v", err)
		})

	if strings.HasPrefix(broker, "ssl://") || strings.HasPrefix(broker, "tls://") || strings.HasPrefix(broker, "mqtts://") {
		opts.SetTLSConfig(&tls.Config{MinVersion: tls.VersionTLS12})
	}

	client := mqtt.NewClient(opts)
	if t := client.Connect(); t.WaitTimeout(20*time.Second) && t.Error() != nil {
		return nil, fmt.Errorf("connect: %w", t.Error())
	}
	return &CommandSubscriber{client: client}, nil
}

func (s *CommandSubscriber) Close() {
	if s.client != nil && s.client.IsConnected() {
		s.client.Disconnect(500)
	}
}

func (s *CommandSubscriber) Wait(ctx context.Context) {
	<-ctx.Done()
}
