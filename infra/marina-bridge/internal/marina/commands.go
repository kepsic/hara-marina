package marina

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
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
				slog.Error("subscribe failed", "source", "marina-cmd", "topic", topic, "err", t.Error())
				return
			}
			slog.Info("subscribed", "source", "marina-cmd", "topic", topic)
		}).
		SetConnectionLostHandler(func(_ mqtt.Client, err error) {
			slog.Warn("connection lost", "source", "marina-cmd", "err", err)
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
