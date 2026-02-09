
/*
    Server Type: PostgreSQL
    Catalogs: account
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
-- Sequence agent_access_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".agent_access_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."agent_access_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".agent_access_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".agent_access_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".agent_access_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "agent_access"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_access') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'agent_access'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."agent_access" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'agent_access' 
        LOOP
            IF column_rec.column_name NOT IN ('id','user_id','agent_id','access_type','duration','status','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."agent_access" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_access' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."agent_access" ADD COLUMN "id" int8 NOT NULL DEFAULT agent_access_id_seq();
        ELSE
            
            ALTER TABLE "public"."agent_access" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."agent_access" ALTER COLUMN "id" SET DEFAULT agent_access_id_seq(); ALTER TABLE "public"."agent_access" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_access' AND column_name = 'user_id' ) THEN
            ALTER TABLE "public"."agent_access" ADD COLUMN "user_id" uuid NOT NULL;
        ELSE
            
            ALTER TABLE "public"."agent_access" ALTER COLUMN "user_id" SET NOT NULL; 
            ALTER TABLE "public"."agent_access" ALTER COLUMN "user_id" DROP DEFAULT; ALTER TABLE "public"."agent_access" ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_access' AND column_name = 'agent_id' ) THEN
            ALTER TABLE "public"."agent_access" ADD COLUMN "agent_id" int8 NOT NULL;
        ELSE
            
            ALTER TABLE "public"."agent_access" ALTER COLUMN "agent_id" SET NOT NULL; 
            ALTER TABLE "public"."agent_access" ALTER COLUMN "agent_id" DROP DEFAULT; ALTER TABLE "public"."agent_access" ALTER COLUMN "agent_id" TYPE int8 USING "agent_id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_access' AND column_name = 'access_type' ) THEN
            ALTER TABLE "public"."agent_access" ADD COLUMN "access_type" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."agent_access" ALTER COLUMN "access_type" DROP NOT NULL; 
            ALTER TABLE "public"."agent_access" ALTER COLUMN "access_type" SET DEFAULT 1; ALTER TABLE "public"."agent_access" ALTER COLUMN "access_type" TYPE int2 USING "access_type"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_access' AND column_name = 'duration' ) THEN
            ALTER TABLE "public"."agent_access" ADD COLUMN "duration" int4 DEFAULT 0;
        ELSE
            
            ALTER TABLE "public"."agent_access" ALTER COLUMN "duration" DROP NOT NULL; 
            ALTER TABLE "public"."agent_access" ALTER COLUMN "duration" SET DEFAULT 0; ALTER TABLE "public"."agent_access" ALTER COLUMN "duration" TYPE int4 USING "duration"::int4;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_access' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."agent_access" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."agent_access" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."agent_access" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."agent_access" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_access' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."agent_access" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."agent_access" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."agent_access" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."agent_access" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_access' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."agent_access" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."agent_access" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."agent_access" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."agent_access" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_access' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."agent_access" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."agent_access" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."agent_access" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."agent_access" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
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
                AND rel.relname = 'agent_access'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."agent_access" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'agent_access'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."agent_access" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
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
        CREATE TABLE "public"."agent_access" (
            "id" int8 NOT NULL DEFAULT agent_access_id_seq(),
            "user_id" uuid NOT NULL,
            "agent_id" int8 NOT NULL,
            "access_type" int2 DEFAULT 1,
            "duration" int4 DEFAULT 0,
            "status" int2 DEFAULT 1,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."agent_access"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."agent_access"."user_id" IS  '用户Id';
    COMMENT ON COLUMN "public"."agent_access"."agent_id" IS  '智能体Id';
    COMMENT ON COLUMN "public"."agent_access"."access_type" IS  '授权类型';
    COMMENT ON COLUMN "public"."agent_access"."duration" IS  '有效时长';
    COMMENT ON COLUMN "public"."agent_access"."status" IS  '状态';
    COMMENT ON COLUMN "public"."agent_access"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."agent_access"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."agent_access"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."agent_access" IS '用户智能体授权';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'agent_access'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."agent_access" ADD CONSTRAINT agent_access_pkey PRIMARY KEY ("id");
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
-- Sequence agent_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".agent_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."agent_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".agent_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".agent_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".agent_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "agent"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'agent'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."agent" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'agent' 
        LOOP
            IF column_rec.column_name NOT IN ('id','code','name','version','status','remark','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."agent" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."agent" ADD COLUMN "id" int8 NOT NULL DEFAULT agent_id_seq();
        ELSE
            
            ALTER TABLE "public"."agent" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."agent" ALTER COLUMN "id" SET DEFAULT agent_id_seq(); ALTER TABLE "public"."agent" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent' AND column_name = 'code' ) THEN
            ALTER TABLE "public"."agent" ADD COLUMN "code" varchar(128) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."agent" ALTER COLUMN "code" SET NOT NULL; 
            ALTER TABLE "public"."agent" ALTER COLUMN "code" DROP DEFAULT; ALTER TABLE "public"."agent" ALTER COLUMN "code" TYPE varchar(128) USING "code"::varchar(128);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent' AND column_name = 'name' ) THEN
            ALTER TABLE "public"."agent" ADD COLUMN "name" varchar(255) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."agent" ALTER COLUMN "name" SET NOT NULL; 
            ALTER TABLE "public"."agent" ALTER COLUMN "name" DROP DEFAULT; ALTER TABLE "public"."agent" ALTER COLUMN "name" TYPE varchar(255) USING "name"::varchar(255);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent' AND column_name = 'version' ) THEN
            ALTER TABLE "public"."agent" ADD COLUMN "version" varchar(64);
        ELSE
            
            ALTER TABLE "public"."agent" ALTER COLUMN "version" DROP NOT NULL; 
            ALTER TABLE "public"."agent" ALTER COLUMN "version" DROP DEFAULT; ALTER TABLE "public"."agent" ALTER COLUMN "version" TYPE varchar(64) USING "version"::varchar(64);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."agent" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."agent" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."agent" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."agent" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent' AND column_name = 'remark' ) THEN
            ALTER TABLE "public"."agent" ADD COLUMN "remark" varchar(1024);
        ELSE
            
            ALTER TABLE "public"."agent" ALTER COLUMN "remark" DROP NOT NULL; 
            ALTER TABLE "public"."agent" ALTER COLUMN "remark" DROP DEFAULT; ALTER TABLE "public"."agent" ALTER COLUMN "remark" TYPE varchar(1024) USING "remark"::varchar(1024);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."agent" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."agent" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."agent" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."agent" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."agent" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."agent" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."agent" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."agent" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."agent" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."agent" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."agent" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."agent" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
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
                AND rel.relname = 'agent'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."agent" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'agent'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."agent" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
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
        CREATE TABLE "public"."agent" (
            "id" int8 NOT NULL DEFAULT agent_id_seq(),
            "code" varchar(128) NOT NULL,
            "name" varchar(255) NOT NULL,
            "version" varchar(64),
            "status" int2 DEFAULT 1,
            "remark" varchar(1024),
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."agent"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."agent"."code" IS  '智能体编码';
    COMMENT ON COLUMN "public"."agent"."name" IS  '智能体名称';
    COMMENT ON COLUMN "public"."agent"."version" IS  '版本';
    COMMENT ON COLUMN "public"."agent"."status" IS  '状态';
    COMMENT ON COLUMN "public"."agent"."remark" IS  '备注';
    COMMENT ON COLUMN "public"."agent"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."agent"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."agent"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."agent" IS '智能体基础信息';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'agent'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."agent" ADD CONSTRAINT agent_pkey PRIMARY KEY ("id");
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
-- Table "user_info"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_info') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'user_info'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."user_info" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'user_info' 
        LOOP
            IF column_rec.column_name NOT IN ('id','name','email','phone','password','status','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."user_info" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_info' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."user_info" ADD COLUMN "id" uuid NOT NULL;
        ELSE
            
            ALTER TABLE "public"."user_info" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."user_info" ALTER COLUMN "id" DROP DEFAULT; ALTER TABLE "public"."user_info" ALTER COLUMN "id" TYPE uuid USING "id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_info' AND column_name = 'name' ) THEN
            ALTER TABLE "public"."user_info" ADD COLUMN "name" varchar(255) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."user_info" ALTER COLUMN "name" SET NOT NULL; 
            ALTER TABLE "public"."user_info" ALTER COLUMN "name" DROP DEFAULT; ALTER TABLE "public"."user_info" ALTER COLUMN "name" TYPE varchar(255) USING "name"::varchar(255);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_info' AND column_name = 'email' ) THEN
            ALTER TABLE "public"."user_info" ADD COLUMN "email" varchar(255);
        ELSE
            
            ALTER TABLE "public"."user_info" ALTER COLUMN "email" DROP NOT NULL; 
            ALTER TABLE "public"."user_info" ALTER COLUMN "email" DROP DEFAULT; ALTER TABLE "public"."user_info" ALTER COLUMN "email" TYPE varchar(255) USING "email"::varchar(255);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_info' AND column_name = 'phone' ) THEN
            ALTER TABLE "public"."user_info" ADD COLUMN "phone" varchar(32);
        ELSE
            
            ALTER TABLE "public"."user_info" ALTER COLUMN "phone" DROP NOT NULL; 
            ALTER TABLE "public"."user_info" ALTER COLUMN "phone" DROP DEFAULT; ALTER TABLE "public"."user_info" ALTER COLUMN "phone" TYPE varchar(32) USING "phone"::varchar(32);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_info' AND column_name = 'password' ) THEN
            ALTER TABLE "public"."user_info" ADD COLUMN "password" varchar(255);
        ELSE
            
            ALTER TABLE "public"."user_info" ALTER COLUMN "password" DROP NOT NULL; 
            ALTER TABLE "public"."user_info" ALTER COLUMN "password" DROP DEFAULT; ALTER TABLE "public"."user_info" ALTER COLUMN "password" TYPE varchar(255) USING "password"::varchar(255);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_info' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."user_info" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."user_info" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."user_info" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."user_info" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_info' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."user_info" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."user_info" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."user_info" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."user_info" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_info' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."user_info" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."user_info" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."user_info" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."user_info" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_info' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."user_info" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."user_info" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."user_info" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."user_info" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
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
                AND rel.relname = 'user_info'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."user_info" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'user_info'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."user_info" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
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
        CREATE TABLE "public"."user_info" (
            "id" uuid NOT NULL,
            "name" varchar(255) NOT NULL,
            "email" varchar(255),
            "phone" varchar(32),
            "password" varchar(255),
            "status" int2 DEFAULT 1,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."user_info"."id" IS  '用户唯一标识';
    COMMENT ON COLUMN "public"."user_info"."name" IS  '用户名称';
    COMMENT ON COLUMN "public"."user_info"."email" IS  '邮箱';
    COMMENT ON COLUMN "public"."user_info"."phone" IS  '手机号';
    COMMENT ON COLUMN "public"."user_info"."password" IS  '登录密码';
    COMMENT ON COLUMN "public"."user_info"."status" IS  '状态';
    COMMENT ON COLUMN "public"."user_info"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."user_info"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."user_info"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."user_info" IS '平台用户';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'user_info'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."user_info" ADD CONSTRAINT user_info_pkey PRIMARY KEY ("id");
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
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_info') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_user_info_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_user_info_last_at') || '"
                BEFORE UPDATE ON "public"."user_info"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_user_info_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_agent_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_agent_last_at') || '"
                BEFORE UPDATE ON "public"."agent"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_agent_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_access') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_agent_access_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_agent_access_last_at') || '"
                BEFORE UPDATE ON "public"."agent_access"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_agent_access_last_at_trigger_func"()';
    END IF;
END;
$$;


