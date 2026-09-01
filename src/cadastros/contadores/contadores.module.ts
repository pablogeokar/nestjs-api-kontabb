import { Module } from '@nestjs/common';
import { ContadoresController } from './contadores.controller';
import { ContadoresService } from './contadores.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ContadoresController],
  providers: [ContadoresService],
  exports: [ContadoresService],
})
export class ContadoresModule { }
