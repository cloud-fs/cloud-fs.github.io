function loadFeatures() {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "features.html", true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4 && xhr.status === 200) {
        document.getElementById("content").innerHTML = xhr.responseText;
      }
    };
    xhr.send();
  }
  