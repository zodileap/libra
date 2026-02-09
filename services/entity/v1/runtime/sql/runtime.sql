
/*
    Server Type: PostgreSQL
    Catalogs: runtime
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
-- Sequence agent_session_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".agent_session_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."agent_session_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".agent_session_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".agent_session_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".agent_session_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "agent_session"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_session') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'agent_session'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."agent_session" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'agent_session' 
        LOOP
            IF column_rec.column_name NOT IN ('id','user_id','agent_code','status','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."agent_session" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_session' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."agent_session" ADD COLUMN "id" int8 NOT NULL DEFAULT agent_session_id_seq();
        ELSE
            
            ALTER TABLE "public"."agent_session" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."agent_session" ALTER COLUMN "id" SET DEFAULT agent_session_id_seq(); ALTER TABLE "public"."agent_session" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_session' AND column_name = 'user_id' ) THEN
            ALTER TABLE "public"."agent_session" ADD COLUMN "user_id" uuid NOT NULL;
        ELSE
            
            ALTER TABLE "public"."agent_session" ALTER COLUMN "user_id" SET NOT NULL; 
            ALTER TABLE "public"."agent_session" ALTER COLUMN "user_id" DROP DEFAULT; ALTER TABLE "public"."agent_session" ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_session' AND column_name = 'agent_code' ) THEN
            ALTER TABLE "public"."agent_session" ADD COLUMN "agent_code" varchar(128) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."agent_session" ALTER COLUMN "agent_code" SET NOT NULL; 
            ALTER TABLE "public"."agent_session" ALTER COLUMN "agent_code" DROP DEFAULT; ALTER TABLE "public"."agent_session" ALTER COLUMN "agent_code" TYPE varchar(128) USING "agent_code"::varchar(128);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_session' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."agent_session" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."agent_session" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."agent_session" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."agent_session" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_session' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."agent_session" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."agent_session" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."agent_session" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."agent_session" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_session' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."agent_session" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."agent_session" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."agent_session" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."agent_session" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_session' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."agent_session" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."agent_session" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."agent_session" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."agent_session" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
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
                AND rel.relname = 'agent_session'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."agent_session" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'agent_session'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."agent_session" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
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
        CREATE TABLE "public"."agent_session" (
            "id" int8 NOT NULL DEFAULT agent_session_id_seq(),
            "user_id" uuid NOT NULL,
            "agent_code" varchar(128) NOT NULL,
            "status" int2 DEFAULT 1,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."agent_session"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."agent_session"."user_id" IS  '用户Id';
    COMMENT ON COLUMN "public"."agent_session"."agent_code" IS  '智能体编码';
    COMMENT ON COLUMN "public"."agent_session"."status" IS  '状态';
    COMMENT ON COLUMN "public"."agent_session"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."agent_session"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."agent_session"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."agent_session" IS '智能体会话';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'agent_session'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."agent_session" ADD CONSTRAINT agent_session_pkey PRIMARY KEY ("id");
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
-- Sequence preview_endpoint_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".preview_endpoint_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."preview_endpoint_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".preview_endpoint_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".preview_endpoint_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".preview_endpoint_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "preview_endpoint"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'preview_endpoint') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'preview_endpoint'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."preview_endpoint" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'preview_endpoint' 
        LOOP
            IF column_rec.column_name NOT IN ('id','sandbox_id','url','status','expiration','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."preview_endpoint" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'preview_endpoint' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."preview_endpoint" ADD COLUMN "id" int8 NOT NULL DEFAULT preview_endpoint_id_seq();
        ELSE
            
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "id" SET DEFAULT preview_endpoint_id_seq(); ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'preview_endpoint' AND column_name = 'sandbox_id' ) THEN
            ALTER TABLE "public"."preview_endpoint" ADD COLUMN "sandbox_id" int8 NOT NULL;
        ELSE
            
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "sandbox_id" SET NOT NULL; 
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "sandbox_id" DROP DEFAULT; ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "sandbox_id" TYPE int8 USING "sandbox_id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'preview_endpoint' AND column_name = 'url' ) THEN
            ALTER TABLE "public"."preview_endpoint" ADD COLUMN "url" varchar(512) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "url" SET NOT NULL; 
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "url" DROP DEFAULT; ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "url" TYPE varchar(512) USING "url"::varchar(512);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'preview_endpoint' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."preview_endpoint" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'preview_endpoint' AND column_name = 'expiration' ) THEN
            ALTER TABLE "public"."preview_endpoint" ADD COLUMN "expiration" int4 DEFAULT 0;
        ELSE
            
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "expiration" DROP NOT NULL; 
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "expiration" SET DEFAULT 0; ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "expiration" TYPE int4 USING "expiration"::int4;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'preview_endpoint' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."preview_endpoint" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'preview_endpoint' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."preview_endpoint" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'preview_endpoint' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."preview_endpoint" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."preview_endpoint" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
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
                AND rel.relname = 'preview_endpoint'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."preview_endpoint" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'preview_endpoint'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."preview_endpoint" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
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
        CREATE TABLE "public"."preview_endpoint" (
            "id" int8 NOT NULL DEFAULT preview_endpoint_id_seq(),
            "sandbox_id" int8 NOT NULL,
            "url" varchar(512) NOT NULL,
            "status" int2 DEFAULT 1,
            "expiration" int4 DEFAULT 0,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."preview_endpoint"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."preview_endpoint"."sandbox_id" IS  '沙盒实例Id';
    COMMENT ON COLUMN "public"."preview_endpoint"."url" IS  '预览URL';
    COMMENT ON COLUMN "public"."preview_endpoint"."status" IS  '状态';
    COMMENT ON COLUMN "public"."preview_endpoint"."expiration" IS  '过期时间（秒）';
    COMMENT ON COLUMN "public"."preview_endpoint"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."preview_endpoint"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."preview_endpoint"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."preview_endpoint" IS '预览地址';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'preview_endpoint'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."preview_endpoint" ADD CONSTRAINT preview_endpoint_pkey PRIMARY KEY ("id");
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
-- Sequence sandbox_instance_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".sandbox_instance_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."sandbox_instance_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".sandbox_instance_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".sandbox_instance_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".sandbox_instance_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "sandbox_instance"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sandbox_instance') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'sandbox_instance'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."sandbox_instance" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'sandbox_instance' 
        LOOP
            IF column_rec.column_name NOT IN ('id','session_id','container_id','preview_url','status','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."sandbox_instance" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sandbox_instance' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."sandbox_instance" ADD COLUMN "id" int8 NOT NULL DEFAULT sandbox_instance_id_seq();
        ELSE
            
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "id" SET DEFAULT sandbox_instance_id_seq(); ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sandbox_instance' AND column_name = 'session_id' ) THEN
            ALTER TABLE "public"."sandbox_instance" ADD COLUMN "session_id" int8 NOT NULL;
        ELSE
            
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "session_id" SET NOT NULL; 
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "session_id" DROP DEFAULT; ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "session_id" TYPE int8 USING "session_id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sandbox_instance' AND column_name = 'container_id' ) THEN
            ALTER TABLE "public"."sandbox_instance" ADD COLUMN "container_id" varchar(255);
        ELSE
            
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "container_id" DROP NOT NULL; 
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "container_id" DROP DEFAULT; ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "container_id" TYPE varchar(255) USING "container_id"::varchar(255);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sandbox_instance' AND column_name = 'preview_url' ) THEN
            ALTER TABLE "public"."sandbox_instance" ADD COLUMN "preview_url" varchar(512);
        ELSE
            
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "preview_url" DROP NOT NULL; 
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "preview_url" DROP DEFAULT; ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "preview_url" TYPE varchar(512) USING "preview_url"::varchar(512);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sandbox_instance' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."sandbox_instance" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sandbox_instance' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."sandbox_instance" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sandbox_instance' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."sandbox_instance" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sandbox_instance' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."sandbox_instance" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."sandbox_instance" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
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
                AND rel.relname = 'sandbox_instance'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."sandbox_instance" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'sandbox_instance'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."sandbox_instance" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
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
        CREATE TABLE "public"."sandbox_instance" (
            "id" int8 NOT NULL DEFAULT sandbox_instance_id_seq(),
            "session_id" int8 NOT NULL,
            "container_id" varchar(255),
            "preview_url" varchar(512),
            "status" int2 DEFAULT 1,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."sandbox_instance"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."sandbox_instance"."session_id" IS  '会话Id';
    COMMENT ON COLUMN "public"."sandbox_instance"."container_id" IS  '容器Id';
    COMMENT ON COLUMN "public"."sandbox_instance"."preview_url" IS  '预览地址';
    COMMENT ON COLUMN "public"."sandbox_instance"."status" IS  '状态';
    COMMENT ON COLUMN "public"."sandbox_instance"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."sandbox_instance"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."sandbox_instance"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."sandbox_instance" IS '沙盒实例';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'sandbox_instance'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."sandbox_instance" ADD CONSTRAINT sandbox_instance_pkey PRIMARY KEY ("id");
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
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_session') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_agent_session_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_agent_session_last_at') || '"
                BEFORE UPDATE ON "public"."agent_session"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_agent_session_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sandbox_instance') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_sandbox_instance_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_sandbox_instance_last_at') || '"
                BEFORE UPDATE ON "public"."sandbox_instance"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_sandbox_instance_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'preview_endpoint') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_preview_endpoint_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_preview_endpoint_last_at') || '"
                BEFORE UPDATE ON "public"."preview_endpoint"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_preview_endpoint_last_at_trigger_func"()';
    END IF;
END;
$$;


