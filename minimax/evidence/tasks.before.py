"""Small task-list business module, before the requested priority-filter change."""


def list_tasks(tasks, status=None):
    """Return tasks in their original order, optionally filtered by status."""
    return [dict(task) for task in tasks if status is None or task["status"] == status]
