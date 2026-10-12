-- Sample analytics over Lakehouse Sync history tables.
-- Replace <catalog>.<schema> with program.lakehouseSync.catalog / .schema.
-- Each synced table has an SCD Type 2 history table: lb_<table>_history, with CDC columns
-- _pg_change_type (insert | update_preimage | update_postimage | delete), _pg_lsn, _pg_xid, _timestamp.
-- Verify column names against your workspace after the first sync.

-- Latest state per learner and module (drop deletes and pre-images)
CREATE OR REPLACE VIEW <catalog>.<schema>.v_module_progress_latest AS
SELECT * EXCEPT (rn) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY email, module_key ORDER BY _pg_lsn DESC) AS rn
  FROM <catalog>.<schema>.lb_module_progress_history
  WHERE _pg_change_type IN ('insert', 'update_postimage', 'delete')
) WHERE rn = 1 AND _pg_change_type <> 'delete';

-- Average score and learner count per module
SELECT module_key, COUNT(*) AS learners, ROUND(AVG(score), 1) AS avg_score
FROM <catalog>.<schema>.v_module_progress_latest
GROUP BY module_key ORDER BY avg_score;

-- Every quiz attempt over time (improvement after retakes)
SELECT date_trunc('day', created_at) AS day, module_key, COUNT(*) AS attempts, ROUND(AVG(score), 1) AS avg_score
FROM <catalog>.<schema>.lb_quiz_attempts_history
WHERE _pg_change_type = 'insert'
GROUP BY 1, 2 ORDER BY 1, 2;

-- Most common assistant questions (no learner identity)
SELECT question, COUNT(*) AS times_asked
FROM <catalog>.<schema>.lb_ask_log_history
WHERE _pg_change_type = 'insert'
GROUP BY question ORDER BY times_asked DESC LIMIT 25;
