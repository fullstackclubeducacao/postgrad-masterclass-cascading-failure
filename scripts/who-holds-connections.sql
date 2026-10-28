-- Quem está segurando as conexões? Rode durante a carga com `make who`.
SELECT state,
       application_name,
       count(*)                                        AS conexoes,
       round(max(extract(epoch FROM now() - query_start))::numeric, 1) AS mais_antiga_s,
       left(regexp_replace(query, '\s+', ' ', 'g'), 70) AS trecho_sql
  FROM pg_stat_activity
 WHERE datname = 'shop'
   AND pid <> pg_backend_pid()
 GROUP BY state, application_name, trecho_sql
 ORDER BY conexoes DESC;

SELECT count(*) AS total_conexoes, current_setting('max_connections') AS max_connections
  FROM pg_stat_activity;
