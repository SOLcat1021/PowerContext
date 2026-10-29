# TASK-PRIORITY: task priority filter, revision 1

Add an optional `priority=None` parameter to `tasks.py:list_tasks`.
Accepted values are `high`, `medium`, `low` and None. Reject other values with
ValueError, including when the input list is empty. Filter status AND priority
when both are given. Preserve input order, status positional-call compatibility,
empty-input behavior and copy-on-return semantics. Never mutate input tasks.

Required sources: this specification; tasks.py:list_tasks; test_tasks.py:TargetTests;
test_tasks.py:RegressionTests. These tests must remain identical before and after.
