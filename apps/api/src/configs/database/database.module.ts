// database.module.ts connects Sequelize to PostgreSQL and makes models injectable
// with @InjectModel(). Railway's Postgres is reached over the private network.
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>('NODE_ENV') === 'production';

        return {
          dialect: 'postgres' as const,
          uri: config.get<string>('DATABASE_URL'),

          // Models register themselves through SequelizeModule.forFeature() in
          // each feature module, so this list never has to be maintained here.
          autoLoadModels: true,

          // Never true. synchronize drops columns it does not recognise, which is
          // acceptable in a scratch project and not acceptable with customer data.
          // Schema changes go through migrations - see migrations/.
          synchronize: false,

          logging: isProduction ? false : console.log,

          // Railway terminates TLS on the managed Postgres but presents a
          // certificate for an internal host, so the chain cannot be verified.
          // The connection is still encrypted and never leaves the private network.
          dialectOptions: isProduction
            ? { ssl: { require: true, rejectUnauthorized: false } }
            : {},

          pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
