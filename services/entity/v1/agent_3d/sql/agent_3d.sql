
/*
    Server Type: PostgreSQL
    Catalogs: agent_3d
    Schema: public
*/

-- ********
-- EXTENSION
-- ********
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ********
-- Delete Foreign Key
-- ********
DO $$
BEGIN

END
$$;


-- ********
-- Sequence dcc_binding_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".dcc_binding_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."dcc_binding_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".dcc_binding_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".dcc_binding_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".dcc_binding_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "dcc_binding"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dcc_binding') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'dcc_binding'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."dcc_binding" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'dcc_binding' 
        LOOP
            IF column_rec.column_name NOT IN ('id','user_id','software','version','executable_path','status','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."dcc_binding" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dcc_binding' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."dcc_binding" ADD COLUMN "id" int8 NOT NULL DEFAULT dcc_binding_id_seq();
        ELSE
            
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "id" SET DEFAULT dcc_binding_id_seq(); ALTER TABLE "public"."dcc_binding" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dcc_binding' AND column_name = 'user_id' ) THEN
            ALTER TABLE "public"."dcc_binding" ADD COLUMN "user_id" uuid NOT NULL;
        ELSE
            
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "user_id" SET NOT NULL; 
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "user_id" DROP DEFAULT; ALTER TABLE "public"."dcc_binding" ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dcc_binding' AND column_name = 'software' ) THEN
            ALTER TABLE "public"."dcc_binding" ADD COLUMN "software" varchar(64) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "software" SET NOT NULL; 
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "software" DROP DEFAULT; ALTER TABLE "public"."dcc_binding" ALTER COLUMN "software" TYPE varchar(64) USING "software"::varchar(64);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dcc_binding' AND column_name = 'version' ) THEN
            ALTER TABLE "public"."dcc_binding" ADD COLUMN "version" varchar(64);
        ELSE
            
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "version" DROP NOT NULL; 
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "version" DROP DEFAULT; ALTER TABLE "public"."dcc_binding" ALTER COLUMN "version" TYPE varchar(64) USING "version"::varchar(64);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dcc_binding' AND column_name = 'executable_path' ) THEN
            ALTER TABLE "public"."dcc_binding" ADD COLUMN "executable_path" varchar(512);
        ELSE
            
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "executable_path" DROP NOT NULL; 
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "executable_path" DROP DEFAULT; ALTER TABLE "public"."dcc_binding" ALTER COLUMN "executable_path" TYPE varchar(512) USING "executable_path"::varchar(512);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dcc_binding' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."dcc_binding" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."dcc_binding" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dcc_binding' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."dcc_binding" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."dcc_binding" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dcc_binding' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."dcc_binding" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."dcc_binding" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dcc_binding' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."dcc_binding" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."dcc_binding" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."dcc_binding" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
        END IF;

        -- Search for existing unique and primary key constraints and drop them
        -- 查找并删除现有的唯一约束和主键约束
        BEGIN
            -- Drop primary key constraint
            -- 删除主键约束
            SELECT conname INTO v_constraint_name
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'dcc_binding'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."dcc_binding" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'dcc_binding'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."dcc_binding" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping unique constraint %: %', v_unique_constraint_name, SQLERRM;
                END;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error during dropping primary key or unique constraints: %', SQLERRM;
        END;

        -- 添加所有字段的CHECK约束
    ELSE
        -- If the table does not exist, then create the table.
        -- 如果表不存在，则创建表。
        CREATE TABLE "public"."dcc_binding" (
            "id" int8 NOT NULL DEFAULT dcc_binding_id_seq(),
            "user_id" uuid NOT NULL,
            "software" varchar(64) NOT NULL,
            "version" varchar(64),
            "executable_path" varchar(512),
            "status" int2 DEFAULT 1,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."dcc_binding"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."dcc_binding"."user_id" IS  '用户Id';
    COMMENT ON COLUMN "public"."dcc_binding"."software" IS  '软件标识';
    COMMENT ON COLUMN "public"."dcc_binding"."version" IS  '软件版本';
    COMMENT ON COLUMN "public"."dcc_binding"."executable_path" IS  '可执行文件路径';
    COMMENT ON COLUMN "public"."dcc_binding"."status" IS  '状态';
    COMMENT ON COLUMN "public"."dcc_binding"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."dcc_binding"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."dcc_binding"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."dcc_binding" IS 'DCC软件绑定';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'dcc_binding'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."dcc_binding" ADD CONSTRAINT dcc_binding_pkey PRIMARY KEY ("id");
            EXCEPTION 
                WHEN duplicate_table THEN
                    RAISE NOTICE 'Primary key constraint already exists';
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error adding primary key constraint: %', SQLERRM;
            END;
        END IF;
    END;

    -- Add unique constraints
    -- 添加唯一约束
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding unique constraints: %', SQLERRM;
    END;

    -- Add indexes
    -- 添加索引
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding indexes: %', SQLERRM;
    END;
END
$$;

-- ********
-- Sequence model_result_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".model_result_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."model_result_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".model_result_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".model_result_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".model_result_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "model_result"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'model_result') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'model_result'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."model_result" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'model_result' 
        LOOP
            IF column_rec.column_name NOT IN ('id','task_id','format','file_path','status','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."model_result" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_result' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."model_result" ADD COLUMN "id" int8 NOT NULL DEFAULT model_result_id_seq();
        ELSE
            
            ALTER TABLE "public"."model_result" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."model_result" ALTER COLUMN "id" SET DEFAULT model_result_id_seq(); ALTER TABLE "public"."model_result" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_result' AND column_name = 'task_id' ) THEN
            ALTER TABLE "public"."model_result" ADD COLUMN "task_id" int8 NOT NULL;
        ELSE
            
            ALTER TABLE "public"."model_result" ALTER COLUMN "task_id" SET NOT NULL; 
            ALTER TABLE "public"."model_result" ALTER COLUMN "task_id" DROP DEFAULT; ALTER TABLE "public"."model_result" ALTER COLUMN "task_id" TYPE int8 USING "task_id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_result' AND column_name = 'format' ) THEN
            ALTER TABLE "public"."model_result" ADD COLUMN "format" varchar(64);
        ELSE
            
            ALTER TABLE "public"."model_result" ALTER COLUMN "format" DROP NOT NULL; 
            ALTER TABLE "public"."model_result" ALTER COLUMN "format" DROP DEFAULT; ALTER TABLE "public"."model_result" ALTER COLUMN "format" TYPE varchar(64) USING "format"::varchar(64);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_result' AND column_name = 'file_path' ) THEN
            ALTER TABLE "public"."model_result" ADD COLUMN "file_path" varchar(512);
        ELSE
            
            ALTER TABLE "public"."model_result" ALTER COLUMN "file_path" DROP NOT NULL; 
            ALTER TABLE "public"."model_result" ALTER COLUMN "file_path" DROP DEFAULT; ALTER TABLE "public"."model_result" ALTER COLUMN "file_path" TYPE varchar(512) USING "file_path"::varchar(512);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_result' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."model_result" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."model_result" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."model_result" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."model_result" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_result' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."model_result" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."model_result" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."model_result" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."model_result" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_result' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."model_result" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."model_result" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."model_result" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."model_result" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_result' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."model_result" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."model_result" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."model_result" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."model_result" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
        END IF;

        -- Search for existing unique and primary key constraints and drop them
        -- 查找并删除现有的唯一约束和主键约束
        BEGIN
            -- Drop primary key constraint
            -- 删除主键约束
            SELECT conname INTO v_constraint_name
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'model_result'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."model_result" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'model_result'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."model_result" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping unique constraint %: %', v_unique_constraint_name, SQLERRM;
                END;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error during dropping primary key or unique constraints: %', SQLERRM;
        END;

        -- 添加所有字段的CHECK约束
    ELSE
        -- If the table does not exist, then create the table.
        -- 如果表不存在，则创建表。
        CREATE TABLE "public"."model_result" (
            "id" int8 NOT NULL DEFAULT model_result_id_seq(),
            "task_id" int8 NOT NULL,
            "format" varchar(64),
            "file_path" varchar(512),
            "status" int2 DEFAULT 1,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."model_result"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."model_result"."task_id" IS  '任务Id';
    COMMENT ON COLUMN "public"."model_result"."format" IS  '结果格式';
    COMMENT ON COLUMN "public"."model_result"."file_path" IS  '文件路径';
    COMMENT ON COLUMN "public"."model_result"."status" IS  '状态';
    COMMENT ON COLUMN "public"."model_result"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."model_result"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."model_result"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."model_result" IS '三维结果';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'model_result'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."model_result" ADD CONSTRAINT model_result_pkey PRIMARY KEY ("id");
            EXCEPTION 
                WHEN duplicate_table THEN
                    RAISE NOTICE 'Primary key constraint already exists';
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error adding primary key constraint: %', SQLERRM;
            END;
        END IF;
    END;

    -- Add unique constraints
    -- 添加唯一约束
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding unique constraints: %', SQLERRM;
    END;

    -- Add indexes
    -- 添加索引
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding indexes: %', SQLERRM;
    END;
END
$$;

-- ********
-- Sequence model_task_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".model_task_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."model_task_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".model_task_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".model_task_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".model_task_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "model_task"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'model_task') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'model_task'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."model_task" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'model_task' 
        LOOP
            IF column_rec.column_name NOT IN ('id','user_id','prompt','status','result_path','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."model_task" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_task' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."model_task" ADD COLUMN "id" int8 NOT NULL DEFAULT model_task_id_seq();
        ELSE
            
            ALTER TABLE "public"."model_task" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."model_task" ALTER COLUMN "id" SET DEFAULT model_task_id_seq(); ALTER TABLE "public"."model_task" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_task' AND column_name = 'user_id' ) THEN
            ALTER TABLE "public"."model_task" ADD COLUMN "user_id" uuid NOT NULL;
        ELSE
            
            ALTER TABLE "public"."model_task" ALTER COLUMN "user_id" SET NOT NULL; 
            ALTER TABLE "public"."model_task" ALTER COLUMN "user_id" DROP DEFAULT; ALTER TABLE "public"."model_task" ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_task' AND column_name = 'prompt' ) THEN
            ALTER TABLE "public"."model_task" ADD COLUMN "prompt" varchar(2048);
        ELSE
            
            ALTER TABLE "public"."model_task" ALTER COLUMN "prompt" DROP NOT NULL; 
            ALTER TABLE "public"."model_task" ALTER COLUMN "prompt" DROP DEFAULT; ALTER TABLE "public"."model_task" ALTER COLUMN "prompt" TYPE varchar(2048) USING "prompt"::varchar(2048);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_task' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."model_task" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."model_task" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."model_task" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."model_task" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_task' AND column_name = 'result_path' ) THEN
            ALTER TABLE "public"."model_task" ADD COLUMN "result_path" varchar(512);
        ELSE
            
            ALTER TABLE "public"."model_task" ALTER COLUMN "result_path" DROP NOT NULL; 
            ALTER TABLE "public"."model_task" ALTER COLUMN "result_path" DROP DEFAULT; ALTER TABLE "public"."model_task" ALTER COLUMN "result_path" TYPE varchar(512) USING "result_path"::varchar(512);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_task' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."model_task" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."model_task" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."model_task" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."model_task" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_task' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."model_task" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."model_task" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."model_task" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."model_task" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_task' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."model_task" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."model_task" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."model_task" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."model_task" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
        END IF;

        -- Search for existing unique and primary key constraints and drop them
        -- 查找并删除现有的唯一约束和主键约束
        BEGIN
            -- Drop primary key constraint
            -- 删除主键约束
            SELECT conname INTO v_constraint_name
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'model_task'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."model_task" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'model_task'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."model_task" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping unique constraint %: %', v_unique_constraint_name, SQLERRM;
                END;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error during dropping primary key or unique constraints: %', SQLERRM;
        END;

        -- 添加所有字段的CHECK约束
    ELSE
        -- If the table does not exist, then create the table.
        -- 如果表不存在，则创建表。
        CREATE TABLE "public"."model_task" (
            "id" int8 NOT NULL DEFAULT model_task_id_seq(),
            "user_id" uuid NOT NULL,
            "prompt" varchar(2048),
            "status" int2 DEFAULT 1,
            "result_path" varchar(512),
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."model_task"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."model_task"."user_id" IS  '用户Id';
    COMMENT ON COLUMN "public"."model_task"."prompt" IS  '任务描述';
    COMMENT ON COLUMN "public"."model_task"."status" IS  '任务状态';
    COMMENT ON COLUMN "public"."model_task"."result_path" IS  '结果路径';
    COMMENT ON COLUMN "public"."model_task"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."model_task"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."model_task"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."model_task" IS '三维任务';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'model_task'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."model_task" ADD CONSTRAINT model_task_pkey PRIMARY KEY ("id");
            EXCEPTION 
                WHEN duplicate_table THEN
                    RAISE NOTICE 'Primary key constraint already exists';
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error adding primary key constraint: %', SQLERRM;
            END;
        END IF;
    END;

    -- Add unique constraints
    -- 添加唯一约束
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding unique constraints: %', SQLERRM;
    END;

    -- Add indexes
    -- 添加索引
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding indexes: %', SQLERRM;
    END;
END
$$;





-- ********
-- Add Foreign Key
-- ********
DO $$
BEGIN

END
$$;

-- ********
-- Create Triggers
-- ********

DO $$
DECLARE
    trigger_rec RECORD;
    func_rec RECORD; 
BEGIN
    -- 删除所有存在的触发器和关联函数
    FOR trigger_rec IN (
        SELECT tgname as trigger_name, 
               tgrelid::regclass as table_name,
               p.proname as function_name
        FROM pg_trigger t
        JOIN pg_proc p ON t.tgfoid = p.oid
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
    ) LOOP
        -- 删除触发器
        EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(trigger_rec.trigger_name) || 
                ' ON ' || trigger_rec.table_name;
        -- 删除关联的触发器函数 
        EXECUTE 'DROP FUNCTION IF EXISTS public.' || quote_ident(trigger_rec.function_name) || '()';
    END LOOP;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'model_task') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_model_task_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_model_task_last_at') || '"
                BEFORE UPDATE ON "public"."model_task"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_model_task_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'model_result') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_model_result_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_model_result_last_at') || '"
                BEFORE UPDATE ON "public"."model_result"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_model_result_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dcc_binding') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_dcc_binding_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_dcc_binding_last_at') || '"
                BEFORE UPDATE ON "public"."dcc_binding"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_dcc_binding_last_at_trigger_func"()';
    END IF;
END;
$$;


