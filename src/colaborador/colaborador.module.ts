import { Module } from '@nestjs/common';
import { ColaboradorController } from './colaborador.controller';
import { ColaboradorService } from './colaborador.service';
import { ColaboradorSessionService } from './colaborador-session.service';

@Module({
  controllers: [ColaboradorController],
  providers: [ColaboradorService, ColaboradorSessionService],
  exports: [ColaboradorService],
})
export class ColaboradorModule {}
