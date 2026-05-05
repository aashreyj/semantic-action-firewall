package saf

normalized_target := lower(trim(input.action.target, " "))

target_without_scheme := trim_prefix(trim_prefix(normalized_target, "https://"), "http://")

target_authority := split(target_without_scheme, "/")[0]

target_authority_parts := split(target_authority, "@")

target_host_with_user := target_authority_parts[count(target_authority_parts) - 1]

target_hostname := split(target_host_with_user, ":")[0]

is_domain_allowed if {
  target_hostname != ""
  some domain in input.policy.allowedDomains
  target_hostname == lower(domain)
}

is_domain_allowed if {
  target_hostname != ""
  some domain in input.policy.allowedDomains
  endswith(target_hostname, concat("", [".", lower(domain)]))
}

result := {
  "decision": "ALLOW",
  "matchedRule": "network.connect.allowlist",
  "reason": "Network target is allowlisted",
} if {
  input.action.category == "network"
  input.action.operation == "connect"
  is_domain_allowed
}

result := {
  "decision": "DENY",
  "matchedRule": "network.connect.deny",
  "reason": "Network target is not allowlisted",
} if {
  input.action.category == "network"
  input.action.operation == "connect"
  not is_domain_allowed
}
