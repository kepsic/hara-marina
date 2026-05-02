FROM emqx/emqx:5.8.6

USER root

# Telemetry off
ENV EMQX_TELEMETRY__ENABLE=false

# Cluster: single-node (Railway = one container)
ENV EMQX_NODE__NAME=emqx@127.0.0.1
ENV EMQX_NODE__COOKIE=hara-marina-emqx-cookie
ENV EMQX_CLUSTER__DISCOVERY_STRATEGY=manual

# Listeners
ENV EMQX_LISTENERS__TCP__DEFAULT__BIND="0.0.0.0:1883"
ENV EMQX_LISTENERS__WS__DEFAULT__BIND="0.0.0.0:8083"
ENV EMQX_LISTENERS__SSL__DEFAULT__ENABLE=false
ENV EMQX_LISTENERS__WSS__DEFAULT__ENABLE=false

# Dashboard
ENV EMQX_DASHBOARD__LISTENERS__HTTP__BIND="0.0.0.0:18083"

# Anonymous MQTT off — forces username/password (fail_action=deny is default in 5.x)
ENV EMQX_ALLOW_ANONYMOUS=false

# Bootstrap entrypoint and post-start provisioner
COPY --chmod=0755 bootstrap.sh /usr/local/bin/bootstrap.sh
COPY --chmod=0755 provision.sh /usr/local/bin/provision.sh

ENTRYPOINT ["/usr/local/bin/bootstrap.sh"]
