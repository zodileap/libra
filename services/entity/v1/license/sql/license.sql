
/*
    Server Type: PostgreSQL
    Catalogs: license
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
-- Sequence activation_code_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".activation_code_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."activation_code_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".activation_code_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".activation_code_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".activation_code_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "activation_code"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activation_code') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'activation_code'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."activation_code" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'activation_code' 
        LOOP
            IF column_rec.column_name NOT IN ('id','code','agent_code','user_id','status','expiration','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."activation_code" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_code' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."activation_code" ADD COLUMN "id" int8 NOT NULL DEFAULT activation_code_id_seq();
        ELSE
            
            ALTER TABLE "public"."activation_code" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."activation_code" ALTER COLUMN "id" SET DEFAULT activation_code_id_seq(); ALTER TABLE "public"."activation_code" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_code' AND column_name = 'code' ) THEN
            ALTER TABLE "public"."activation_code" ADD COLUMN "code" varchar(128) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."activation_code" ALTER COLUMN "code" SET NOT NULL; 
            ALTER TABLE "public"."activation_code" ALTER COLUMN "code" DROP DEFAULT; ALTER TABLE "public"."activation_code" ALTER COLUMN "code" TYPE varchar(128) USING "code"::varchar(128);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_code' AND column_name = 'agent_code' ) THEN
            ALTER TABLE "public"."activation_code" ADD COLUMN "agent_code" varchar(128) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."activation_code" ALTER COLUMN "agent_code" SET NOT NULL; 
            ALTER TABLE "public"."activation_code" ALTER COLUMN "agent_code" DROP DEFAULT; ALTER TABLE "public"."activation_code" ALTER COLUMN "agent_code" TYPE varchar(128) USING "agent_code"::varchar(128);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_code' AND column_name = 'user_id' ) THEN
            ALTER TABLE "public"."activation_code" ADD COLUMN "user_id" uuid;
        ELSE
            
            ALTER TABLE "public"."activation_code" ALTER COLUMN "user_id" DROP NOT NULL; 
            ALTER TABLE "public"."activation_code" ALTER COLUMN "user_id" DROP DEFAULT; ALTER TABLE "public"."activation_code" ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_code' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."activation_code" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."activation_code" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."activation_code" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."activation_code" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_code' AND column_name = 'expiration' ) THEN
            ALTER TABLE "public"."activation_code" ADD COLUMN "expiration" int4 DEFAULT 0;
        ELSE
            
            ALTER TABLE "public"."activation_code" ALTER COLUMN "expiration" DROP NOT NULL; 
            ALTER TABLE "public"."activation_code" ALTER COLUMN "expiration" SET DEFAULT 0; ALTER TABLE "public"."activation_code" ALTER COLUMN "expiration" TYPE int4 USING "expiration"::int4;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_code' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."activation_code" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."activation_code" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."activation_code" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."activation_code" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_code' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."activation_code" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."activation_code" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."activation_code" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."activation_code" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_code' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."activation_code" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."activation_code" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."activation_code" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."activation_code" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
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
                AND rel.relname = 'activation_code'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."activation_code" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'activation_code'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."activation_code" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
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
        CREATE TABLE "public"."activation_code" (
            "id" int8 NOT NULL DEFAULT activation_code_id_seq(),
            "code" varchar(128) NOT NULL,
            "agent_code" varchar(128) NOT NULL,
            "user_id" uuid,
            "status" int2 DEFAULT 1,
            "expiration" int4 DEFAULT 0,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."activation_code"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."activation_code"."code" IS  '激活码';
    COMMENT ON COLUMN "public"."activation_code"."agent_code" IS  '智能体编码';
    COMMENT ON COLUMN "public"."activation_code"."user_id" IS  '用户Id';
    COMMENT ON COLUMN "public"."activation_code"."status" IS  '状态';
    COMMENT ON COLUMN "public"."activation_code"."expiration" IS  '过期时间（秒）';
    COMMENT ON COLUMN "public"."activation_code"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."activation_code"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."activation_code"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."activation_code" IS '激活码';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'activation_code'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."activation_code" ADD CONSTRAINT activation_code_pkey PRIMARY KEY ("id");
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
-- Sequence activation_record_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".activation_record_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."activation_record_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".activation_record_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".activation_record_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".activation_record_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "activation_record"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activation_record') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'activation_record'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."activation_record" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'activation_record' 
        LOOP
            IF column_rec.column_name NOT IN ('id','activation_code_id','user_id','device_id','status','remark','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."activation_record" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_record' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."activation_record" ADD COLUMN "id" int8 NOT NULL DEFAULT activation_record_id_seq();
        ELSE
            
            ALTER TABLE "public"."activation_record" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."activation_record" ALTER COLUMN "id" SET DEFAULT activation_record_id_seq(); ALTER TABLE "public"."activation_record" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_record' AND column_name = 'activation_code_id' ) THEN
            ALTER TABLE "public"."activation_record" ADD COLUMN "activation_code_id" int8 NOT NULL;
        ELSE
            
            ALTER TABLE "public"."activation_record" ALTER COLUMN "activation_code_id" SET NOT NULL; 
            ALTER TABLE "public"."activation_record" ALTER COLUMN "activation_code_id" DROP DEFAULT; ALTER TABLE "public"."activation_record" ALTER COLUMN "activation_code_id" TYPE int8 USING "activation_code_id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_record' AND column_name = 'user_id' ) THEN
            ALTER TABLE "public"."activation_record" ADD COLUMN "user_id" uuid NOT NULL;
        ELSE
            
            ALTER TABLE "public"."activation_record" ALTER COLUMN "user_id" SET NOT NULL; 
            ALTER TABLE "public"."activation_record" ALTER COLUMN "user_id" DROP DEFAULT; ALTER TABLE "public"."activation_record" ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_record' AND column_name = 'device_id' ) THEN
            ALTER TABLE "public"."activation_record" ADD COLUMN "device_id" varchar(255);
        ELSE
            
            ALTER TABLE "public"."activation_record" ALTER COLUMN "device_id" DROP NOT NULL; 
            ALTER TABLE "public"."activation_record" ALTER COLUMN "device_id" DROP DEFAULT; ALTER TABLE "public"."activation_record" ALTER COLUMN "device_id" TYPE varchar(255) USING "device_id"::varchar(255);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_record' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."activation_record" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."activation_record" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."activation_record" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."activation_record" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_record' AND column_name = 'remark' ) THEN
            ALTER TABLE "public"."activation_record" ADD COLUMN "remark" varchar(1024);
        ELSE
            
            ALTER TABLE "public"."activation_record" ALTER COLUMN "remark" DROP NOT NULL; 
            ALTER TABLE "public"."activation_record" ALTER COLUMN "remark" DROP DEFAULT; ALTER TABLE "public"."activation_record" ALTER COLUMN "remark" TYPE varchar(1024) USING "remark"::varchar(1024);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_record' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."activation_record" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."activation_record" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."activation_record" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."activation_record" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_record' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."activation_record" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."activation_record" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."activation_record" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."activation_record" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activation_record' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."activation_record" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."activation_record" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."activation_record" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."activation_record" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
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
                AND rel.relname = 'activation_record'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."activation_record" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'activation_record'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."activation_record" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
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
        CREATE TABLE "public"."activation_record" (
            "id" int8 NOT NULL DEFAULT activation_record_id_seq(),
            "activation_code_id" int8 NOT NULL,
            "user_id" uuid NOT NULL,
            "device_id" varchar(255),
            "status" int2 DEFAULT 1,
            "remark" varchar(1024),
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."activation_record"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."activation_record"."activation_code_id" IS  '激活码Id';
    COMMENT ON COLUMN "public"."activation_record"."user_id" IS  '用户Id';
    COMMENT ON COLUMN "public"."activation_record"."device_id" IS  '设备Id';
    COMMENT ON COLUMN "public"."activation_record"."status" IS  '状态';
    COMMENT ON COLUMN "public"."activation_record"."remark" IS  '备注';
    COMMENT ON COLUMN "public"."activation_record"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."activation_record"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."activation_record"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."activation_record" IS '激活记录';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'activation_record'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."activation_record" ADD CONSTRAINT activation_record_pkey PRIMARY KEY ("id");
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
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activation_code') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_activation_code_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_activation_code_last_at') || '"
                BEFORE UPDATE ON "public"."activation_code"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_activation_code_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activation_record') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_activation_record_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_activation_record_last_at') || '"
                BEFORE UPDATE ON "public"."activation_record"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_activation_record_last_at_trigger_func"()';
    END IF;
END;
$$;


