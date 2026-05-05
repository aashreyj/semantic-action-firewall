package saf

result := {
  "decision": "FLAG_FOR_INTENT_CHECK",
  "matchedRule": "process.execute.intent",
  "reason": "Process execution requires intent check",
} if {
  input.action.category == "process"
  input.action.operation == "execute"
}
