package saf

workspace_path := trim_suffix(input.context.workspacePath, "/")

is_absolute_path(target) if {
  startswith(target, "/")
}

has_parent_traversal(target) if {
  startswith(target, "../")
}

has_parent_traversal(target) if {
  contains(target, "/../")
}

in_workspace(target) if {
  not is_absolute_path(target)
  not has_parent_traversal(target)
}

in_workspace(target) if {
  is_absolute_path(target)
  target == workspace_path
}

in_workspace(target) if {
  is_absolute_path(target)
  startswith(target, concat("", [workspace_path, "/"]))
}

result := {
  "decision": "ALLOW",
  "matchedRule": "filesystem.read",
  "reason": "Read access is allowed",
} if {
  input.action.category == "filesystem"
  input.action.operation == "read"
}

result := {
  "decision": "FLAG_FOR_INTENT_CHECK",
  "matchedRule": "filesystem.write",
  "reason": "Write requires intent check",
} if {
  input.action.category == "filesystem"
  input.action.operation == "write"
  in_workspace(input.action.target)
}

result := {
  "decision": "DENY",
  "matchedRule": "filesystem.write.outside_workspace",
  "reason": "Write outside workspace is denied",
} if {
  input.action.category == "filesystem"
  input.action.operation == "write"
  not in_workspace(input.action.target)
}

result := {
  "decision": "REQUIRE_APPROVAL",
  "matchedRule": "filesystem.delete",
  "reason": "Delete requires explicit approval",
} if {
  input.action.category == "filesystem"
  input.action.operation == "delete"
  in_workspace(input.action.target)
  not protected_path(input.action.target)
}

result := {
  "decision": "DENY",
  "matchedRule": "filesystem.delete.outside_workspace",
  "reason": "Delete outside workspace is denied",
} if {
  input.action.category == "filesystem"
  input.action.operation == "delete"
  not in_workspace(input.action.target)
  not protected_path(input.action.target)
}
