-- AlterTable route_stops: lectura de geolocalización tomada al momento de cerrar la entrega
-- (distinta de lat/lng, que son las coordenadas planificadas del destino)
ALTER TABLE "route_stops" ADD COLUMN "deliveredLat" DOUBLE PRECISION;
ALTER TABLE "route_stops" ADD COLUMN "deliveredLng" DOUBLE PRECISION;
