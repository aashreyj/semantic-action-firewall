package saf

default decision := "DENY"

default result := {
  "decision": "DENY",
  "matchedRule": "default",
  "reason": "No matching rule",
}

decision := result.decision

is_protected_path(target, protected) if {
  protected == "/"
  startswith(target, "/")
}

is_protected_path(target, protected) if {
  protected != "/"
  target == protected
}

is_protected_path(target, protected) if {
  protected != "/"
  startswith(target, concat("", [protected, "/"]))
}

protected_path(target) if {
  some protected in input.policy.protectedPaths
  is_protected_path(target, protected)
}

result := {
  "decision": "DENY",
  "matchedRule": "protected-path-delete",
  "reason": "Delete blocked on protected path",
} if {
  input.action.category == "filesystem"
  input.action.operation == "delete"
  protected_path(input.action.target)
}
