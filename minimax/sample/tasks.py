"""Small task-list business module, with optional status/priority filtering."""

VALID_PRIORITIES = ("high", "medium", "low")


def list_tasks(tasks, status=None, priority=None):
    """Return tasks in their original order, optionally filtered by status and priority.

    ``status`` keeps its positional-call compatibility. ``priority`` accepts
    ``high``, ``medium``, ``low`` or None; any other value raises ValueError
    (even when no task is supplied). Returned tasks are copies, so the input
    is never mutated.
    """
    if priority is not None and priority not in VALID_PRIORITIES:
        raise ValueError(
            "invalid priority {!r}: expected one of {} or None".format(
                priority, ", ".join(VALID_PRIORITIES)
            )
        )
    return [
        dict(task)
        for task in tasks
        if (status is None or task["status"] == status)
        and (priority is None or task.get("priority") == priority)
    ]
