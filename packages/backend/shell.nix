with import <nixpkgs> {};
mkShell {
  shellHook = ''
    export API="http://localhost:1660"

    function create-session() {
      export id=$(http post $API/create-session dataset=all | jq -r .id)
      echo $id
    }

    function run-frame() {
      http post $API/run-frame id=$id | jq -r .stdout
    }

    function delete-session() {
      http post $API/delete-session id=$id | jq -r .success
      unset id
    }

    function dataset-index() {
      http get $API/dataset-index | jq
    }
  '';
}
