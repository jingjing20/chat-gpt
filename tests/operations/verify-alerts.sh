#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ALERTS_FILE="$ROOT_DIR/docs/observability/alerts.yml"
DASHBOARD_FILE="$ROOT_DIR/docs/observability/dashboard.json"

ruby - "$ALERTS_FILE" <<'RUBY'
require 'yaml'
document = YAML.safe_load(File.read(ARGV.fetch(0)), [], [], true)
rules = document.fetch('groups').flat_map { |group| group.fetch('rules') }
required = %w[
  ApiHighErrorRate
  GenerationHighFailureRate
  GenerationWorkerSilent
  OutboxBacklogTooOld
  GenerationQueueWaitHigh
  ProviderCredentialOrBalanceFailure
  GenerationHeartbeatFailures
  ApiResidentMemoryHigh
  EventForwardLatencyHigh
  RedisClientErrors
]
names = rules.map { |rule| rule.fetch('alert') }
missing = required - names
abort("缺少告警规则：#{missing.join(', ')}") unless missing.empty?
rules.each do |rule|
  abort("告警缺少 expr：#{rule['alert']}") if rule['expr'].to_s.empty?
  abort("告警缺少 severity：#{rule['alert']}") if rule.dig('labels', 'severity').to_s.empty?
  abort("告警缺少 summary：#{rule['alert']}") if rule.dig('annotations', 'summary').to_s.empty?
end
puts "告警规则结构校验通过：#{rules.length} 条"
RUBY

node - "$DASHBOARD_FILE" <<'NODE'
const fs = require('node:fs');
const dashboard = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!Array.isArray(dashboard.panels) || dashboard.panels.length < 8) {
  throw new Error('Dashboard 核心面板不完整');
}
console.log(`Dashboard 结构校验通过：${dashboard.panels.length} 个面板`);
NODE
