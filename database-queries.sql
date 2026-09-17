SELECT
    id,
    name,
    email,
    role,
    disabled,
    must_change,
    datetime(created_at / 1000, 'unixepoch') AS created_at_utc
FROM users
ORDER BY created_at;

SELECT
    users.id AS user_id,
    users.name AS user_name,
    users.email,
    json_extract(transaction_row.value, '$.id') AS transaction_id,
    json_extract(transaction_row.value, '$.amount') AS price,
    json_extract(transaction_row.value, '$.company') AS recipient,
    json_extract(transaction_row.value, '$.date') AS date,
    json_extract(transaction_row.value, '$.time') AS time,
    json_extract(transaction_row.value, '$.name') AS description,
    json_extract(transaction_row.value, '$.referenceCode') AS tracking_code,
    json_extract(transaction_row.value, '$.bank') AS originating_bank,
    json_extract(transaction_row.value, '$.type') AS type,
    json_extract(transaction_row.value, '$.category') AS category,
    coalesce(json_extract(workspaces.data, '$.currency'), 'USD') AS currency,
    transaction_row.key AS transaction_index
FROM workspaces
JOIN users ON users.id = workspaces.user_id
CROSS JOIN json_each(workspaces.data, '$.transactions') AS transaction_row
ORDER BY date DESC, time DESC;

SELECT
    users.id AS user_id,
    users.name,
    users.email,
    workspaces.version,
    coalesce(json_extract(workspaces.data, '$.currency'), 'USD') AS currency,
    json_array_length(workspaces.data, '$.transactions') AS transaction_count,
    json_array_length(workspaces.data, '$.invoices') AS invoice_count,
    json_array_length(workspaces.data, '$.budgets') AS budget_count
FROM workspaces
JOIN users ON users.id = workspaces.user_id;
