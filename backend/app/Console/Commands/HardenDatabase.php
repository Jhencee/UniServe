<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
class HardenDatabase extends Command {
 protected $signature='security:database';
 protected $description='Create database-scoped runtime and migration credentials without exposing secrets';
 public function handle():int {
  if(config('database.default')!=='mysql'){$this->error('MySQL required.');return 1;}
  if(config('database.connections.mysql.username')==='uniserve_app'){$this->info('Runtime credentials are already separated.');return 0;}
  $name=config('database.connections.mysql.database');if(!preg_match('/^[a-zA-Z0-9_]+$/',$name))return 1;
  $pdo=DB::connection()->getPdo();$app=bin2hex(random_bytes(32));$migration=bin2hex(random_bytes(32));
  foreach(['uniserve_app'=>$app,'uniserve_migrate'=>$migration] as $user=>$password){
   DB::unprepared("CREATE USER IF NOT EXISTS '$user'@'localhost' IDENTIFIED BY ".$pdo->quote($password));
   DB::unprepared("ALTER USER '$user'@'localhost' IDENTIFIED BY ".$pdo->quote($password));
   DB::unprepared("REVOKE ALL PRIVILEGES, GRANT OPTION FROM '$user'@'localhost'");
   $permissions=$user==='uniserve_app'?'SELECT, INSERT, UPDATE, DELETE':'ALL PRIVILEGES';
   DB::unprepared("GRANT $permissions ON `$name`.* TO '$user'@'localhost'");
  }
  $env=file_get_contents(base_path('.env'));
  $set=function(string $env,string $user,string $password):string{$env=preg_replace('/^DB_USERNAME=.*$/m','DB_USERNAME='.$user,$env);return preg_replace('/^DB_PASSWORD=.*$/m','DB_PASSWORD='.$password,$env);};
  file_put_contents(base_path('.env.migrations'),$set($env,'uniserve_migrate',$migration));
  file_put_contents(base_path('.env'),$set($env,'uniserve_app',$app));
  $this->call('config:clear');
  $this->info('Runtime DML-only credentials and separate database-scoped migration credentials saved. No passwords printed.');return 0;
 }
}
