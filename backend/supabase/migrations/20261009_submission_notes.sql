-- Queue outcomes live on the submission row (one RESULT line per item).
alter table public.submissions add column if not exists notes text;
